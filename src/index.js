'use strict'

const { deserializeError } = require('serialize-error')
const timeSpan = require('@kikobeats/time-span')()
const $ = require('tinyspawn')

const compile = require('./compile')

const createError = ({ name, message, ...props }) => {
  const error = new Error(message)
  error.name = name
  Object.assign(error, props)
  return error
}

const flags = ({ memory }) => {
  const flags = []
  if (memory) flags.push(`--max-old-space-size=${memory}`)
  return flags.join(' ')
}

module.exports = (snippet, { timeout = 0, memory } = {}) => {
  if (typeof snippet !== 'function') throw new TypeError('Expected a function')
  const compilePromise = compile(snippet)

  const fn = async (...args) => {
    let duration
    try {
      const { filepath } = await compilePromise
      duration = timeSpan()

      const cmd = `node ${flags({ memory })} ${filepath} ${JSON.stringify(
        args
      )}`
      const { stdout } = await $(cmd, {
        timeout,
        killSignal: 'SIGKILL'
      })
      const { isFulfilled, value, profiling } = JSON.parse(stdout)
      profiling.duration = duration()
      if (isFulfilled) return [value, profiling]
      throw deserializeError(value)
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

      throw error
    }
  }

  const cleanup = async () => (await compilePromise).cleanup

  return [fn, cleanup]
}
