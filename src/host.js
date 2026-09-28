'use strict'

const UNKNOWN_METHOD = 'the host does not expose this method'
const TOO_MANY_CALLS = 'the host call budget for this run is exhausted'

const DEFAULT_MAX_CALLS = 32

/**
 * Every inbound message is untrusted. The isolate runs third-party code and can
 * write to the channel descriptor directly, so a message proves that something
 * in the child asked, never that the snippet asked.
 */
const isWellFormed = message =>
  message !== null &&
  typeof message === 'object' &&
  Number.isInteger(message.id) &&
  typeof message.method === 'string' &&
  (message.args === undefined || Array.isArray(message.args))

const attach = (subprocess, host, { maxCalls = DEFAULT_MAX_CALLS } = {}) => {
  const resolved = new Map()

  const answer = (child, id, outcome) => {
    if (child.connected) child.send({ id, ...outcome })
  }

  const resolve = (method, args) => {
    let key
    try {
      key = `${method}:${JSON.stringify(args)}`
    } catch {
      key = undefined
    }
    if (key === undefined) return Promise.resolve().then(() => host[method](...args))

    const seen = resolved.get(key)
    if (seen !== undefined) return seen
    if (resolved.size >= maxCalls) return Promise.reject(new Error(TOO_MANY_CALLS))

    const pending = Promise.resolve().then(() => host[method](...args))
    resolved.set(key, pending)
    return pending
  }

  subprocess.on('message', function (message) {
    if (!isWellFormed(message)) return
    const child = this
    const { id, method, args = [] } = message

    if (!Object.hasOwn(host, method) || typeof host[method] !== 'function') {
      return answer(child, id, { failed: true, reason: UNKNOWN_METHOD })
    }

    resolve(method, args).then(
      value => answer(child, id, { value }),
      error => answer(child, id, { failed: true, reason: error.message })
    )
  })
}

module.exports = { attach, UNKNOWN_METHOD, TOO_MANY_CALLS, DEFAULT_MAX_CALLS }
