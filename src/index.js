'use strict'

const { deserializeError, serializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const { Readable } = require('node:stream')
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

const flags = ({ memory, permissions }) => {
  const flags = ['--disable-warning=ExperimentalWarning', PERMISSION_FLAG]
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  permissions.forEach(resource => flags.push(`--allow-${resource}`))
  return flags.join(' ')
}

module.exports = (snippet, { tmpdir, timeout, memory, throwError = true, allow = {} } = {}) => {
  if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
  const { permissions = [] } = allow
  const compilePromise = compile(snippet, { tmpdir, allow })

  const fn = async (...args) => {
    let duration
    try {
      const { content, cleanupPromise } = await compilePromise

      duration = timeSpan()
      const subprocess = $('node', ['-', JSON.stringify(args)], {
        env: {
          ...process.env,
          NODE_OPTIONS: flags({ memory, permissions })
        },
        timeout,
        killSignal: 'SIGKILL'
      })
      Readable.from(content).pipe(subprocess.stdin)
      const [{ stdout }] = await Promise.all([subprocess, cleanupPromise])
      const { isFulfilled, value, profiling, logging } = JSON.parse(stdout)
      profiling.duration = duration()
      debug('node', {
        memory: `${Math.round(profiling.memory / (1024 * 1024))}MiB`,
        duration: `${Math.round(profiling.duration / 100)}s`
      })

      return isFulfilled
        ? { isFulfilled, value, profiling, logging }
        : throwError
          ? (() => {
              throw deserializeError(value)
            })()
          : { isFulfilled: false, value: deserializeError(value), profiling, logging }
    } catch (error) {
      debug.error(serializeError(error))
      if (error.signalCode === 'SIGTRAP') {
        throw createError({
          name: 'MemoryError',
          message: 'Out of memory',
          profiling: { duration: duration() }
        })
      }

      if (error.signalCode === 'SIGKILL') {
        throw createError({
          name: 'TimeoutError',
          message: 'Execution timed out',
          profiling: { duration: duration() }
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
          profiling: { duration: duration() }
        })
      }

      throw error
    }
  }

  const cleanup = async () => (await compilePromise).cleanup

  return [fn, cleanup]
}
