'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

module.exports = snippet => `
  const args = JSON.parse(process.argv[2])

  const logging = Object.create(null)

  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    console[method] = function (...args) {
      const input = args.join(' ')
      logging[method] === undefined ? logging[method] = [input] : logging[method].push(input)
    }
  }

  ;(async (send) => {
    process.stdout.write = function () {}
    let value
    let isFulfilled

    try {
      value = await (${snippet.toString()})(...args)
      isFulfilled = true
    } catch (error) {
      value = ${SERIALIZE_ERROR}(error)
      isFulfilled = false
    } finally {
      send(JSON.stringify({
        isFulfilled,
        logging,
        value,
        profiling: { memory: process.memoryUsage().rss }
      }))
    }
  })(process.stdout.write.bind(process.stdout))`
