'use strict'

const { deserializeError, serializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const { Readable } = require('node:stream')
const { rm } = require('fs/promises')
const $ = require('tinyspawn')

const { SLOT, UNSPLICEABLE, createShells, keyOf, fill } = require('./compile/shells')
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

const spawn = ({ env, timeout }) => {
  const spawnOpts = { env, timeout, killSignal: 'SIGKILL' }
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
   * to a normal build of the filled snippet: code that needs npm dependencies
   * (they must be installed and bundled), options that cannot be keyed, or a
   * build in which SLOT did not survive exactly once.
   */
  const compileSlot = async (snippet, slot, compileOpts) => {
    const elapsed = timeSpan()
    const filled = () => compile(fill(snippet, slot), compileOpts)

    if (compile.detectDependencies(`(${slot})`).length > 0) return filled()

    const key = keyOf(snippet, compileOpts)
    if (key === undefined) return filled()

    const shell = await shells.get(key, () => compile(snippet, compileOpts))
    if (shell === UNSPLICEABLE) return filled()

    return { content: fill(shell, slot), phases: { install: 0, build: elapsed() } }
  }

  const isolatedFunction = (
    snippet,
    { timeout, memory, throwError = true, allow = {}, esbuild: callEsbuild, slot } = {}
  ) => {
    if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
    if (slot !== undefined) {
      if (typeof slot !== 'string') throw new TypeError('Expected `slot` to be a string')
      if (typeof snippet !== 'string' || snippet.split(SLOT).length !== 2) {
        throw new TypeError(`Expected the snippet to contain \`${SLOT}\` exactly once`)
      }
    }
    const { permissions = [] } = allow
    const compileOpts = { tmpdir, allow, nodePaths, esbuild: callEsbuild ?? esbuild }
    const compilePromise =
      slot === undefined ? compile(snippet, compileOpts) : compileSlot(snippet, slot, compileOpts)

    return async (...args) => {
      let total
      try {
        total = timeSpan()
        const compiled = await compilePromise
        const prelude = `globalThis.__isolated_args=${JSON.stringify(JSON.stringify(args))};`

        const spawnElapsed = timeSpan()
        const subprocess = spawn({
          env: {
            PATH: process.env.PATH,
            NODE_OPTIONS: flags({ memory, permissions })
          },
          timeout
        })
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
