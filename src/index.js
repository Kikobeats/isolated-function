'use strict'

const { Sandbox } = require('v8-sandbox')

const compile = require('./compile')

module.exports = snippet => {
  const sandbox = new Sandbox()
  const codePromise = compile(snippet)

  return async (...args) => {
    const code = await codePromise
    const { error, value } = await sandbox.execute({ code, timeout: 10000, globals: { arguments: args } })
    await sandbox.shutdown()
    if (error) throw error
    return value
  }
}
