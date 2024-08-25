'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

const generateTemplate = snippet => {
  const isFunction = typeof snippet === 'function'
  const value = isFunction ? `await (${snippet.toString()})(...arguments)` : snippet
  const template = `;(async () => {
    try {
      setResult({ value: ${value} })
    } catch(error) {
     setResult({ error: ${SERIALIZE_ERROR}(error) })
    }
  })()`
  return template
}

module.exports = generateTemplate
