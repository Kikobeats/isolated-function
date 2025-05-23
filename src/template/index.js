'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

module.exports = snippet => `
  const args = JSON.parse(process.argv[2])

  /* https://github.com/Kikobeats/null-prototype-object */
  const logging = new (/* @__PURE__ */ (() => { let e = function(){}; return e.prototype = Object.create(null), Object.freeze(e.prototype), e })());

  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    console[method] = function (...args) {
      logging[method] === undefined ? logging[method] = [args] : logging[method].push(args)
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
