'use strict'

const SERIALIZE_ERROR = require('./serialize-error')
const hostChannel = require('./host-channel')

module.exports = (snippet, { hostMethods } = {}) => `;(send => {
  process.stdout.write = function () {}
  const baseline = process.memoryUsage().rss
  const memory = () => { const m = process.memoryUsage(); return {total: m.rss, used: Math.max(0, m.rss - baseline), heap: m.heapUsed, external: m.external} }
  const phases = Object.create(null)
  let accounted = 0
  let depth = 0
  globalThis.__isolated_phase = (name, ms) => { phases[name] = (phases[name] || 0) + ms }
  globalThis.__isolated_time = async (name, thunk) => {
    const at = performance.now()
    const outermost = depth === 0
    depth++
    try { return await thunk() } finally {
      depth--
      const ms = performance.now() - at
      globalThis.__isolated_phase(name, ms)
      if (outermost) accounted += ms
    }
  }
  const reportedPhases = () => Object.keys(phases).length ? phases : undefined
  const respond = (isFulfilled, value, run, logs = {}) => { const {user, system} = process.cpuUsage(); send(JSON.stringify({isFulfilled, logging: logs, value, profiling: {cpu: (user + system) / 1000, memory: memory(), run, accounted, phases: reportedPhases()}})) }

  return Promise.resolve().then(async () => {
    const args = JSON.parse(globalThis.__isolated_args)
${hostMethods ? hostChannel.source(hostMethods) : ''}

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
      ${hostMethods ? `${hostChannel.CLOSE_HOST}()` : ''}
      respond(isFulfilled, value, performance.now() - t0, logging)
    }
  })
  .catch(e => respond(false, ${SERIALIZE_ERROR}(e), 0))
})(process.stdout.write.bind(process.stdout))`
