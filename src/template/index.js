'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

module.exports = snippet => `;(send => {
  process.stdout.write = function () {}
  const respond = (isFulfilled, value, logs = {}) => send(JSON.stringify({isFulfilled, logging: logs, value, profiling: {memory: process.memoryUsage().rss}}))

  return Promise.resolve().then(async () => {
    const args = JSON.parse(process.argv[2])

    /* https://github.com/Kikobeats/null-prototype-object */
    const logging = new (/* @__PURE__ */ (() => { let e = function(){}; return e.prototype = Object.create(null), Object.freeze(e.prototype), e })());
    for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
      console[method] = function (...args) {
        logging[method] === undefined ? logging[method] = [args] : logging[method].push(args)
      }
    }

    let value
    let isFulfilled
    try {
      value = await (${snippet.toString()})(...args)
      isFulfilled = true
    } catch (error) {
      value = ${SERIALIZE_ERROR}(error)
      isFulfilled = false
    } finally {
      respond(isFulfilled, value, logging)
    }
  })
  .catch(e => respond(false, ${SERIALIZE_ERROR}(e)))
})(process.stdout.write.bind(process.stdout))`
