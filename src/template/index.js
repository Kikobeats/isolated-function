'use strict'

const SERIALIZE_ERROR = require('./serialize-error')
const hostChannel = require('./host-channel')

module.exports = (snippet, { hostMethods } = {}) => `;(send => {
  process.stdout.write = function () {}
  const baseline = process.memoryUsage().rss
  const memory = () => { const m = process.memoryUsage(); return {total: m.rss, used: Math.max(0, m.rss - baseline), heap: m.heapUsed, external: m.external} }
  const phases = Object.create(null)
  const OWNED = ['install', 'build', 'spawn', 'run', 'total']
  let accounted = 0
  let depth = 0
  let busySince = 0
  globalThis.__isolated_phase = (name, ms) => { if (!OWNED.includes(name)) phases[name] = (phases[name] || 0) + ms }
  globalThis.__isolated_time = async (name, thunk) => {
    if (OWNED.includes(name)) return thunk()
    const at = performance.now()
    if (depth === 0) busySince = at
    depth++
    try { return await thunk() } finally {
      depth--
      globalThis.__isolated_phase(name, performance.now() - at)
      /* The union of the intervals a span was open, so overlapping siblings
         count once between them and a nested one is not counted again. */
      if (depth === 0) accounted += performance.now() - busySince
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
