'use strict'

const { Sandbox } = require('v8-sandbox')
const { deserializeError } = require('serialize-error')

const compile = require('./compile')

module.exports = (
  snippet,
  {
    timeout = 10000,
    httpEnabled = false,
    timersEnabled = true,
    globals = {}
  } = {}
) => {
  const sandbox = new Sandbox({ httpEnabled, timersEnabled, debug: true })
  const compiling = compile(snippet)
  const initializing = sandbox.initialize()

  return async (...args) => {
    const [code] = await Promise.all([compiling, initializing])
    const { error, value } = await sandbox.execute({
      code,
      timeout,
      globals: { ...globals, arguments: args }
    })
    await sandbox.shutdown()
    if (error) throw require('ensure-error')(deserializeError(error))
    return value
  }
}
