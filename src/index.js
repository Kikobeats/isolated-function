'use strict'

const { Sandbox } = require('v8-sandbox')
const { deserializeError } = require('serialize-error')

const compile = require('./compile')

module.exports = (snippet, { timeout = 10000 } = {}) => {
  const sandbox = new Sandbox()
  const codePromise = compile(snippet)

  return async (...args) => {
    const code = await codePromise
    const { error, value } = await sandbox.execute({
      code,
      timeout,
      globals: { arguments: args }
    })
    await sandbox.shutdown()
    if (error) throw require('ensure-error')(deserializeError(error))
    return value
  }
}
