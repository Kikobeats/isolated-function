'use strict'

const SERIALIZE_ERROR = require('./serialize-error')

module.exports = snippet => `;(send => {
  process.stdout.write = function () {}
  const baseline = process.memoryUsage().rss
  const memory = () => { const m = process.memoryUsage(); return {total: m.rss, used: Math.max(0, m.rss - baseline), heap: m.heapUsed, external: m.external} }
  const respond = (isFulfilled, value, run, logs = {}) => { const {user, system} = process.cpuUsage(); send(JSON.stringify({isFulfilled, logging: logs, value, profiling: {cpu: (user + system) / 1000, memory: memory(), run}})) }

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
    const t0 = performance.now()
    try {
      value = await (${snippet.toString()})(...args)
      isFulfilled = true
    } catch (error) {
      value = ${SERIALIZE_ERROR}(error)
      isFulfilled = false
    } finally {
      respond(isFulfilled, value, performance.now() - t0, logging)
    }
  })
  .catch(e => respond(false, ${SERIALIZE_ERROR}(e), 0))
})(process.stdout.write.bind(process.stdout))`
