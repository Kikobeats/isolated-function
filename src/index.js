'use strict'

const { deserializeError } = require('serialize-error')
const $ = require('tinyspawn')

const compile = require('./compile')

class TimeoutError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TimeoutError'
  }
}

module.exports = (snippet, { timeout = 0 } = {}) => {
  if (typeof snippet !== 'function') throw new TypeError('Expected a function')
  const compilePromise = compile(snippet)

  const fn = async (...args) => {
    try {
      const { filepath } = await compilePromise
      const { stdout } = await $(`node ${filepath} ${JSON.stringify(args)}`, {
        timeout,
        killSignal: 'SIGKILL'
      })
      const { isFulfilled, value } = JSON.parse(stdout)
      if (isFulfilled) return value
      throw deserializeError(value)
    } catch (error) {
      if (error.killed) throw new TimeoutError('Execution timed out')
      throw error
    }
  }

  const cleanup = async () => (await compilePromise).cleanup

  return [fn, cleanup]
}
