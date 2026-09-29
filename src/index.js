'use strict'

const { deserializeError, serializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const { Readable } = require('node:stream')
const { rm } = require('fs/promises')
const $ = require('tinyspawn')

const {
  SLOT,
  UNSPLICEABLE,
  createShells,
  keyOf,
  needsFullBuild,
  fillSource,
  fillShell
} = require('./compile/shells')
const { attach: attachHost } = require('./host')
const compile = require('./compile')
const { debug } = require('./debug')

const createError = ({ name, message, ...props }) => {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}

/* V8 aborts (SIGABRT) on heap exhaustion for any realistic --max-old-space-size,
   and only traps (SIGTRAP) when the limit is too small to boot the heap. Gate the
   abort on V8's message so an unrelated abort is not reported as a memory error. */
const isOutOfMemory = ({ signalCode, stderr }) =>
  signalCode === 'SIGTRAP' || (signalCode === 'SIGABRT' && /out of memory/i.test(stderr ?? ''))

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

const PERMISSION_FLAG = nodeMajor >= 24 ? '--permission' : '--experimental-permission'

const roundMs = entries =>
  Object.fromEntries(entries.map(([key, value]) => [key, Math.round(value)]))

const flags = ({ memory, permissions }) => {
  const flags = ['--disable-warning=ExperimentalWarning', PERMISSION_FLAG]
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  if (permissions.includes('ffi')) flags.push('--experimental-ffi')
  permissions.forEach(resource => flags.push(`--allow-${resource}`))
  return flags.join(' ')
}

const createWallClock = (ms, onFire) => {
  const now = () => performance.now()
  let remaining = ms
  let started = now()
  let depth = 0
  let timer
  let stopped = false

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  const stop = () => {
    stopped = true
    clearTimer()
  }

  const arm = () => {
    if (stopped || depth > 0) return
    const left = remaining - (now() - started)
    if (left <= 0) {
      stop()
      onFire()
      return
    }
    clearTimer()
    timer = setTimeout(() => {
      timer = undefined
      if (stopped) return
      stop()
      onFire()
    }, left)
    timer.unref()
  }

  arm()
  return {
    pause () {
      if (stopped) return
      if (depth === 0) {
        remaining -= now() - started
        clearTimer()
      }
      depth++
    },
    resume () {
      if (stopped || depth === 0) return
      depth--
      if (depth === 0) {
        started = now()
        arm()
      }
    },
    stop
  }
}

const kill = subprocess => {
  try {
    subprocess.kill('SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

const spawn = ({ env, timeout, hasHost }) => {
  const spawnOpts = { env, killSignal: 'SIGKILL' }
  if (hasHost) spawnOpts.stdio = ['pipe', 'pipe', 'pipe', 'ipc']
  else if (Number.isFinite(timeout)) spawnOpts.timeout = timeout
  if (Number.isFinite(timeout)) {
    const seconds = Math.ceil(timeout / 1000)
    return $('sh', ['-c', `ulimit -t ${seconds} && exec node "$@"`, '_', '-'], spawnOpts)
  }
  return $('node', ['-'], spawnOpts)
}

module.exports = ({ tmpdir, nodePaths, esbuild, shellCacheBytes } = {}) => {
  const shells = createShells({ maxBytes: shellCacheBytes })

  /**
   * Builds `snippet` once with SLOT still in it, then fills the slot per call.
   * Anything that would make the cached build wrong for this call falls back
   * to a normal build of the filled snippet: slot code esbuild has to see
   * (see `needsFullBuild`), options that cannot be keyed, or a build in which
   * SLOT did not survive exactly once.
   */
  const compileSlot = async (snippet, slot, compileOpts) => {
    const elapsed = timeSpan()
    const full = () => compile(fillSource(snippet, slot), compileOpts)

    if (needsFullBuild(slot, compileOpts.esbuild)) return full()

    const key = keyOf(snippet, compileOpts)
    if (key === undefined) return full()

    const shell = await shells.get(key, () => compile(snippet, compileOpts))
    if (shell === UNSPLICEABLE) return full()

    const install = shell.compiled?.phases.install ?? 0
    return {
      content: fillShell(shell.content, slot),
      phases: { install, build: elapsed() - install }
    }
  }

  const isolatedFunction = (
    snippet,
    {
      timeout,
      memory,
      throwError = true,
      allow = {},
      esbuild: callEsbuild,
      slot,
      host,
      maxHostCalls,
      hostCallTimeout
    } = {}
  ) => {
    if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
    if (slot !== undefined) {
      if (typeof slot !== 'string') throw new TypeError('Expected `slot` to be a string')
      if (typeof snippet !== 'string' || snippet.split(SLOT).length !== 2) {
        throw new TypeError(`Expected the snippet to contain \`${SLOT}\` exactly once`)
      }
    }
    if (maxHostCalls !== undefined && (!Number.isInteger(maxHostCalls) || maxHostCalls < 0)) {
      throw new TypeError('Expected `maxHostCalls` to be a finite non-negative integer')
    }
    if (
      hostCallTimeout !== undefined &&
      (typeof hostCallTimeout !== 'number' || !(hostCallTimeout > 0))
    ) {
      throw new TypeError('Expected `hostCallTimeout` to be a positive number')
    }
    const { permissions = [] } = allow
    const hostMethods = host === undefined ? undefined : Object.keys(host)
    if (hostMethods?.length === 0) throw new TypeError('Expected `host` to expose a method')
    const compileOpts = { tmpdir, allow, nodePaths, esbuild: callEsbuild ?? esbuild, hostMethods }
    const compilePromise =
      slot === undefined ? compile(snippet, compileOpts) : compileSlot(snippet, slot, compileOpts)

    return async (...args) => {
      let total
      try {
        total = timeSpan()
        const compiled = await compilePromise
        const prelude = `globalThis.__isolated_args=${JSON.stringify(JSON.stringify(args))};`

        const spawnElapsed = timeSpan()
        const hasHost = hostMethods !== undefined
        const subprocess = spawn({
          env: {
            PATH: process.env.PATH,
            NODE_OPTIONS: flags({ memory, permissions })
          },
          timeout,
          hasHost
        })
        // Time the child spends parked on a host reply is outside the wall clock.
        // `ulimit -t` still caps its CPU, and a call it does not await keeps the clock running.
        const clock =
          hasHost && Number.isFinite(timeout)
            ? createWallClock(timeout, () => kill(subprocess))
            : undefined
        if (clock) subprocess.on('close', () => clock.stop())
        if (hasHost) {
          attachHost(subprocess, host, {
            maxCalls: maxHostCalls,
            clock,
            callTimeout: hostCallTimeout
          })
        }
        subprocess.stdin?.on('error', () => {})
        Readable.from([prelude, compiled.content]).pipe(subprocess.stdin)
        const { stdout } = await subprocess
        const spawnMs = spawnElapsed()
        const { isFulfilled, value, profiling, logging } = JSON.parse(stdout)
        const { run, ...rest } = profiling
        const result = {
          ...rest,
          size: Buffer.byteLength(compiled.content),
          phases: {
            ...compiled.phases,
            spawn: spawnMs - run,
            run,
            total: total()
          }
        }
        debug('node', {
          ...result,
          cpu: Math.round(result.cpu),
          phases: roundMs(Object.entries(result.phases))
        })

        return isFulfilled
          ? { isFulfilled, value, profiling: result, logging }
          : throwError
            ? (() => {
                throw deserializeError(value)
              })()
            : { isFulfilled: false, value: deserializeError(value), profiling: result, logging }
      } catch (error) {
        debug.error(serializeError(error))
        const profiling = { phases: { total: total() } }

        if (isOutOfMemory(error)) {
          throw createError({
            name: 'MemoryError',
            message: 'Out of memory',
            profiling
          })
        }

        if (error.signalCode === 'SIGKILL') {
          throw createError({
            name: 'TimeoutError',
            message: 'Execution timed out',
            profiling
          })
        }

        if (error.signalCode === 'SIGXCPU') {
          throw createError({
            name: 'CpuTimeError',
            message: 'CPU time limit exceeded',
            profiling
          })
        }

        if (error.code === 'ERR_ACCESS_DENIED') {
          const permission = error.permission
            ? error.permission
            : error.message.includes('getaddrinfo')
              ? 'network'
              : undefined

          throw createError({
            name: 'PermissionError',
            message: `Access to '${permission}' has been restricted`,
            profiling
          })
        }

        throw error
      }
    }
  }

  isolatedFunction.teardown = async () => {
    shells.clear()
    const { DEFAULT_TMPDIR } = compile
    const dir = tmpdir || DEFAULT_TMPDIR
    await rm(dir, { recursive: true, force: true })
  }

  isolatedFunction.SLOT = SLOT
  isolatedFunction.shells = shells

  return isolatedFunction
}

module.exports.SLOT = SLOT
