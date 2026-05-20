'use strict'

const { deserializeError, serializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const { Readable } = require('node:stream')
const { rm } = require('fs/promises')
const $ = require('tinyspawn')

const compile = require('./compile')
const { debug } = require('./debug')

const createError = ({ name, message, ...props }) => {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}

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

const spawn = ({ args, env, timeout }) => {
  const spawnOpts = { env, timeout, killSignal: 'SIGKILL' }
  if (Number.isFinite(timeout)) {
    const seconds = Math.ceil(timeout / 1000)
    return $('sh', ['-c', `ulimit -t ${seconds} && exec node "$@"`, '_', '-', args], spawnOpts)
  }
  return $('node', ['-', args], spawnOpts)
}

module.exports = ({ tmpdir, nodePaths } = {}) => {
  const isolatedFunction = (snippet, { timeout, memory, throwError = true, allow = {} } = {}) => {
    if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
    const { permissions = [] } = allow
    const compilePromise = compile(snippet, { tmpdir, allow, nodePaths })

    return async (...args) => {
      let total
      try {
        total = timeSpan()
        const compiled = await compilePromise

        const spawnElapsed = timeSpan()
        const subprocess = spawn({
          args: JSON.stringify(args),
          env: {
            ...process.env,
            NODE_OPTIONS: flags({ memory, permissions })
          },
          timeout
        })
        subprocess.stdin.on('error', () => {})
        Readable.from(compiled.content).pipe(subprocess.stdin)
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

        if (error.signalCode === 'SIGTRAP') {
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
    const { DEFAULT_TMPDIR } = compile
    const dir = tmpdir || DEFAULT_TMPDIR
    await rm(dir, { recursive: true, force: true })
  }

  return isolatedFunction
}
