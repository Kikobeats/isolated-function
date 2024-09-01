'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

const generateTemplate = snippet => {
  const template = `
  const args = JSON.parse(process.argv[2])

  ;(async () => {
    try {
      const value = await (${snippet.toString()})(...args)
      console.log(JSON.stringify({ isFulfilled: true, value }))
    } catch (error) {
     console.log(JSON.stringify({ isFulfilled: false, value: ${SERIALIZE_ERROR}(error) }))
    }
  })()

  `

  return template
}

module.exports = generateTemplate
