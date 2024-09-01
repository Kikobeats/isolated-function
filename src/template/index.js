'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

const generateTemplate = snippet => `
  const args = JSON.parse(process.argv[2])

  ;(async () => {
    let value
    let isFulfilled

    try {
      value = await (${snippet.toString()})(...args)
      isFulfilled = true
    } catch (error) {
      value = ${SERIALIZE_ERROR}(error)
      isFulfilled = false
    } finally {
      console.log(JSON.stringify({
        isFulfilled,
        value,
        profiling: { memory: process.memoryUsage().rss }
      }))
    }
  })()`

module.exports = generateTemplate
