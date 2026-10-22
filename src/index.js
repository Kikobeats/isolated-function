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
const { METHOD: SSRF_METHOD, assertCanCheck, start: startDialCheck } = require('./egress')
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

const DISABLE_UNCHECKED_SQLITE_FLAG = '--no-experimental-sqlite'
const canDisableSqlite = process.allowedNodeEnvironmentFlags.has(DISABLE_UNCHECKED_SQLITE_FLAG)

const DISABLE_WASM_TRAP_HANDLER = '--disable-wasm-trap-handler'
const canDisableWasmTrapHandler = process.allowedNodeEnvironmentFlags.has(DISABLE_WASM_TRAP_HANDLER)

const roundMs = entries =>
  Object.fromEntries(entries.map(([key, value]) => [key, Math.round(value)]))

const flags = ({ memory, permissions }) => {
  const flags = ['--disable-warning=ExperimentalWarning', PERMISSION_FLAG]
  if (canDisableSqlite) flags.push(DISABLE_UNCHECKED_SQLITE_FLAG)
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  if (process.platform === 'linux' && memory && canDisableWasmTrapHandler) {
    flags.push(DISABLE_WASM_TRAP_HANDLER)
  }
  if (permissions.includes('ffi')) flags.push('--experimental-ffi')
  permissions.forEach(resource => flags.push(`--allow-${resource}`))
  return flags.join(' ')
}

// Official Node builds leave pointer compression off, so there is no 4GB cage.
// A build that enables it reserves that cage inside RLIMIT_AS, and the child
// cannot start unless the ceiling clears it. The slack is off-heap room
// (Buffer, WebAssembly), which --max-old-space-size ignores.
const CAGE_MB = process.config?.variables?.v8_enable_pointer_compression === 1 ? 4096 : 0
const ADDRESS_SLACK_MB = 1024

const virtualKb = memory => (CAGE_MB + ADDRESS_SLACK_MB + memory) * 1024

const spawn = ({ env, timeout, hasHost, memory }) => {
  const spawnOpts = { env, timeout, killSignal: 'SIGKILL' }
  if (hasHost) spawnOpts.stdio = ['pipe', 'pipe', 'pipe', 'ipc']
  const limits = []
  if (process.platform === 'linux' && memory) limits.push(`ulimit -v ${virtualKb(memory)}`)
  // Soft limit only. An equal hard limit makes Linux send SIGKILL, which is
  // indistinguishable from the OOM killer.
  if (Number.isFinite(timeout)) limits.push(`ulimit -S -t ${Math.ceil(timeout / 1000)}`)
  if (limits.length === 0) return $('node', ['-'], spawnOpts)
  return $('sh', ['-c', `${limits.join(' && ')} && exec node "$@"`, '_', '-'], spawnOpts)
}

module.exports = ({ tmpdir, nodePaths, esbuild } = {}) => {
  const shells = createShells()

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
    { timeout, memory, throwError = true, allow = {}, esbuild: callEsbuild, slot, host, ssrf } = {}
  ) => {
    if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
    if (slot !== undefined) {
      if (typeof slot !== 'string') throw new TypeError('Expected `slot` to be a string')
      if (typeof snippet !== 'string' || snippet.split(SLOT).length !== 2) {
        throw new TypeError(`Expected the snippet to contain \`${SLOT}\` exactly once`)
      }
    }
    const { permissions = [] } = allow
    const hostMethods = host === undefined ? undefined : Object.keys(host)
    assertCanCheck(ssrf, { permissions, hostMethods })
    const checksDials = typeof ssrf === 'function'
    const hasHost = hostMethods !== undefined || checksDials
    if (hostMethods?.length === 0) throw new TypeError('Expected `host` to expose a method')
    const compileOpts = { tmpdir, allow, nodePaths, esbuild: callEsbuild ?? esbuild, hostMethods }
    const compilePromise =
      slot === undefined ? compile(snippet, compileOpts) : compileSlot(snippet, slot, compileOpts)

    return async (...args) => {
      let total
      try {
        total = timeSpan()
        const compiled = await compilePromise
        const dial = checksDials ? startDialCheck(ssrf) : undefined
        const ipcHost = dial ? { ...host, [SSRF_METHOD]: dial.answer } : host
        const prelude = `${dial ? dial.prelude : ''}globalThis.__isolated_args=${JSON.stringify(
          JSON.stringify(args)
        )};`

        const spawnElapsed = timeSpan()
        const subprocess = spawn({
          env: {
            PATH: process.env.PATH,
            NODE_OPTIONS: flags({ memory, permissions })
          },
          timeout,
          hasHost,
          memory
        })
        if (hasHost) attachHost(subprocess, ipcHost)
        subprocess.stdin?.on('error', () => {})
        Readable.from([prelude, compiled.content]).pipe(subprocess.stdin)
        const { stdout } = await subprocess
        const spawnMs = spawnElapsed()
        const { isFulfilled, value, profiling, logging } = JSON.parse(stdout)
        const { run, accounted = 0, phases: programPhases, ...rest } = profiling
        const result = {
          ...rest,
          size: Buffer.byteLength(compiled.content),
          phases: {
            ...programPhases,
            ...compiled.phases,
            // `spawn` is what the host saw minus everything the child did, so
            // it needs the whole run; `run` reports only what no span claimed.
            spawn: spawnMs - run,
            run: Math.max(0, run - accounted),
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

        if (isOutOfMemory(error) || (error.signalCode === 'SIGKILL' && !error.killed)) {
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
