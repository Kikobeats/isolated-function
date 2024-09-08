'use strict'

const { deserializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const $ = require('tinyspawn')
const path = require('path')

const compile = require('./compile')

const createError = ({ name, message, ...props }) => {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}

const flags = ({ filename, memory }) => {
  const flags = ['--experimental-permission', `--allow-fs-read=${filename}`]
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  return flags.join(' ')
}

module.exports = (snippet, { timeout, memory, throwError = true } = {}) => {
  if (!['function', 'string'].includes(typeof snippet)) throw new TypeError('Expected a function')
  const compilePromise = compile(snippet)

  const fn = async (...args) => {
    let duration
    try {
      const { filepath } = await compilePromise

      const cwd = path.dirname(filepath)
      const filename = path.basename(filepath)
      const cmd = `node ${flags({ filename, memory })} ${filename} ${JSON.stringify(args)}`

      duration = timeSpan()
      const { stdout } = await $(cmd, {
        cwd,
        timeout,
        killSignal: 'SIGKILL'
      })
      const { isFulfilled, value, profiling } = JSON.parse(stdout)
      profiling.duration = duration()
      if (isFulfilled) return { isFulfilled, value, profiling }
      if (throwError) throw deserializeError(value)
      return { isFulfilled: false, value: deserializeError(value), profiling }
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
