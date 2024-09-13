'use strict'

const { Readable } = require('node:stream')
const { deserializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const $ = require('tinyspawn')

const compile = require('./compile')
const { debug } = require('./measure')

const createError = ({ name, message, ...props }) => {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}

const flags = ({ memory }) => {
  const flags = ['--disable-warning=ExperimentalWarning', '--experimental-permission']
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  return flags.join(' ')
}

module.exports = (snippet, { tmpdir, timeout, memory, throwError = true } = {}) => {
  if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
  const compilePromise = compile(snippet, tmpdir)

  const fn = async (...args) => {
    let duration
    try {
      const { content, cleanupPromise } = await compilePromise

      duration = timeSpan()
      const subprocess = $('node', ['-', JSON.stringify(args)], {
        env: {
          ...process.env,
          NODE_OPTIONS: flags({ memory })
        },
        timeout,
        killSignal: 'SIGKILL'
      })
      Readable.from(content).pipe(subprocess.stdin)
      const [{ stdout }] = await Promise.all([subprocess, cleanupPromise])
      const { isFulfilled, value, profiling, logging } = JSON.parse(stdout)
      profiling.duration = duration()
      debug('node', {
        duration: `${Math.round(profiling.duration / 100)}s`,
        memory: `${Math.round(profiling.memory / (1024 * 1024))}MiB`
      })

      return isFulfilled
        ? { isFulfilled, value, profiling, logging }
        : throwError
          ? (() => {
              throw deserializeError(value)
            })()
          : { isFulfilled: false, value: deserializeError(value), profiling, logging }
    } catch (error) {
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
        throw createError({
          name: 'PermissionError',
          message: `Access to '${error.permission}' has been restricted`,
          profiling: { duration: duration() }
        })
      }

      throw error
    }
  }

  const cleanup = async () => (await compilePromise).cleanup

  return [fn, cleanup]
}
