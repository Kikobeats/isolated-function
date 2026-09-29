'use strict'

const UNKNOWN_METHOD = 'the host does not expose this method'
const TOO_MANY_CALLS = 'the host call budget for this run is exhausted'
const UNANSWERED_CALL = 'the host did not answer in time'

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
 * The isolate kept working after this call. Releasing the pause can only give
 * time back: a message cannot stop the clock on its own.
 */
const isStillRunning = message =>
  message !== null &&
  typeof message === 'object' &&
  Number.isInteger(message.id) &&
  message.running === true &&
  message.method === undefined

/**
 * A rejection value is whatever the host method threw, which need not be an
 * Error, and the reason travels as JSON regardless.
 */
const INDESCRIBABLE = 'the host failed with a value that cannot be described'

const describe = value => {
  try {
    if (value instanceof Error && typeof value.message === 'string') return value.message
    return String(value)
  } catch {
    return INDESCRIBABLE
  }
}

/**
 * A snippet that never awaits its call can finish and close the channel while
 * the reply is in flight. Without a callback the resulting EPIPE is emitted on
 * the subprocess, and an `error` there fails the whole run.
 */
const absorbSendError = () => {}

/**
 * A pending call holds the wall clock open, so a host that never answers would
 * leave the run with no bound at all. The call is bounded instead of the run:
 * the snippet gets an error it can handle, and the clock starts again.
 */
const answeredWithin = (promise, ms) => {
  if (!Number.isFinite(ms)) return promise
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(UNANSWERED_CALL)), ms)
      timer.unref()
    })
  ]).finally(() => clearTimeout(timer))
}

const attach = (subprocess, host, { maxCalls = DEFAULT_MAX_CALLS, clock, callTimeout } = {}) => {
  const resolved = new Map()
  const byId = new Map()
  /**
   * Fixed when the run starts. A method added on `host` later is not reachable.
   * Bound to `host` so a method call still sees that object as `this`.
   */
  const exposed = new Map()
  for (const name of Object.keys(host)) {
    if (typeof host[name] === 'function') exposed.set(name, host[name].bind(host))
  }

  /**
   * A value the channel cannot carry, such as a BigInt, makes `send` throw. The
   * isolate is waiting on this id and would otherwise wait until its timeout,
   * so the failure is reported over the same reply.
   */
  const answer = (id, outcome) => {
    if (!subprocess.connected) return
    try {
      subprocess.send({ id, ...outcome }, absorbSendError)
    } catch (error) {
      if (outcome.failed) return
      try {
        subprocess.send({ id, failed: true, reason: describe(error) }, absorbSendError)
      } catch {}
    }
  }

  /**
   * The clock stops when the call starts, which is before the child can say
   * whether it is parked. `release` puts that time back when the snippet kept
   * running.
   */
  const release = id => {
    const invocation = byId.get(id)
    if (invocation === undefined || invocation.settled || invocation.released) return
    invocation.released = true
    if (invocation.held) clock?.resume()
  }

  const resolve = (id, fn, method, args) => {
    let key
    try {
      key = `${method}:${JSON.stringify(args)}`
    } catch {
      return Promise.reject(new Error(TOO_MANY_CALLS))
    }

    const seen = resolved.get(key)
    if (seen !== undefined) {
      byId.set(id, seen)
      return seen.promise
    }
    if (resolved.size >= maxCalls) return Promise.reject(new Error(TOO_MANY_CALLS))

    const invocation = { held: false, released: false, settled: false }
    invocation.promise = Promise.resolve().then(async () => {
      clock?.pause()
      invocation.held = true
      if (invocation.released) clock?.resume()
      try {
        return await answeredWithin(
          Promise.resolve().then(() => fn(...args)),
          callTimeout
        )
      } finally {
        invocation.settled = true
        if (!invocation.released) clock?.resume()
      }
    })
    resolved.set(key, invocation)
    byId.set(id, invocation)
    return invocation.promise
  }

  subprocess.on('message', message => {
    if (isStillRunning(message)) return release(message.id)
    if (!isWellFormed(message)) return
    const { id, method, args = [] } = message

    const fn = exposed.get(method)
    if (fn === undefined) return answer(id, { failed: true, reason: UNKNOWN_METHOD })

    resolve(id, fn, method, args)
      .then(
        value => answer(id, { value }),
        error => answer(id, { failed: true, reason: describe(error) })
      )
      .catch(() => {})
  })
}

module.exports = {
  attach,
  UNKNOWN_METHOD,
  TOO_MANY_CALLS,
  UNANSWERED_CALL,
  INDESCRIBABLE,
  DEFAULT_MAX_CALLS
}
