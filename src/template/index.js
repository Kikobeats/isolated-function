'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

const DISALLOW_INTERNALS = [
  '_dispatch',
  'base64ToBuffer',
  'bufferToBase64',
  'define',
  'defineAsync',
  'dispatch',
  'httpRequest',
  'info',
  'setResult'
]

const generateTemplate = snippet => {
  const value = (() => {
    return `await (() => {
      let ${DISALLOW_INTERNALS.join(',')};
      globalThis = { clearTimeout, setTimeout }
      globalThis.global = globalThis
      return (${snippet.toString()})(...arguments)
    })()`
  })()

  const template = `;(async () => {
  try {
    setResult({
      value: ${value}
    })
  } catch(error) {
   setResult({ error: ${SERIALIZE_ERROR}(error) })
  }
})()`

  return template
}

module.exports = generateTemplate
