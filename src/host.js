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

/**
 * A rejection value is whatever the host method threw, which need not be an
 * Error, and the reason travels as JSON regardless.
 */
const describe = value =>
  value instanceof Error && typeof value.message === 'string' ? value.message : String(value)

/**
 * A snippet that never awaits its call can finish and close the channel while
 * the reply is in flight. Without a callback the resulting EPIPE is emitted on
 * the subprocess, and an `error` there fails the whole run.
 */
const absorbSendError = () => {}

const attach = (subprocess, host, { maxCalls = DEFAULT_MAX_CALLS } = {}) => {
  const resolved = new Map()

  /**
   * A value the channel cannot carry, such as a BigInt, makes `send` throw. The
   * isolate is waiting on this id and would otherwise wait until its timeout,
   * so the failure is reported over the same reply.
   */
  const answer = (child, id, outcome) => {
    if (!child.connected) return
    try {
      child.send({ id, ...outcome }, absorbSendError)
    } catch (error) {
      if (outcome.failed) return
      try {
        child.send({ id, failed: true, reason: describe(error) }, absorbSendError)
      } catch {}
    }
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
      error => answer(child, id, { failed: true, reason: describe(error) })
    )
  })
}

module.exports = { attach, UNKNOWN_METHOD, TOO_MANY_CALLS, DEFAULT_MAX_CALLS }
