'use strict'

const { createHash } = require('crypto')

const UNKNOWN_METHOD = 'the host does not expose this method'
const UNSHAREABLE_ARGS = 'the host call arguments cannot be compared'
const OVER_MEMORY = 'the host call results exceed the run memory limit'

const BYTES_PER_MB = 1024 * 1024
const BYTES_PER_REMEMBERED_CALL = 256
const BYTES_PER_UNREAD_REPLY = 512

const WIDE_CHARACTER = /[\u0100-\uffff]/
const BYTES_PER_WIDE_CHARACTER = 2

const storedBytes = text => (WIDE_CHARACTER.test(text) ? BYTES_PER_WIDE_CHARACTER : 1) * text.length

const digest = call => createHash('sha256').update(call).digest('base64url')

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
const INDESCRIBABLE = 'the host failed with a value that cannot be described'

const describe = value => {
  try {
    if (value instanceof Error && typeof value.message === 'string') return value.message
    return String(value)
  } catch {
    return INDESCRIBABLE
  }
}

const failure = reason => JSON.stringify({ failed: true, reason })
const UNKNOWN_METHOD_ANSWER = failure(UNKNOWN_METHOD)
const UNSHAREABLE_ARGS_ANSWER = failure(UNSHAREABLE_ARGS)
const OVER_MEMORY_ANSWER = failure(OVER_MEMORY)

const attach = (subprocess, host, { memory } = {}) => {
  const answers = new Map()
  const limit = memory ? memory * BYTES_PER_MB : Infinity
  let held = 0

  const take = bytes => {
    if (held + bytes > limit) return false
    held += bytes
    return true
  }

  /**
   * Fixed when the run starts. A method added on `host` later is not reachable.
   * Bound to `host` so a method call still sees that object as `this`.
   */
  const exposed = new Map()
  for (const name of Object.keys(host)) {
    if (typeof host[name] === 'function') exposed.set(name, host[name].bind(host))
  }

  /**
   * A value the channel cannot carry, such as a BigInt, fails its call rather
   * than leaving the isolate waiting on this id until its timeout.
   */
  const serialize = value => {
    try {
      return JSON.stringify({ value })
    } catch (error) {
      return failure(describe(error))
    }
  }

  let unread = 0
  let outOfMemory = false

  const exceedMemory = () => {
    outOfMemory = true
    subprocess.kill('SIGKILL')
  }

  const awaitReply = () => {
    if (unread + BYTES_PER_UNREAD_REPLY > limit) return false
    unread += BYTES_PER_UNREAD_REPLY
    return true
  }

  const answer = (id, text) => {
    const bytes = Buffer.byteLength(text)
    if (unread + bytes > limit) return exceedMemory()
    unread += bytes
    const written = () => {
      unread -= BYTES_PER_UNREAD_REPLY + bytes
    }
    if (!subprocess.connected) return written()
    try {
      subprocess.send({ id, ...JSON.parse(text) }, written)
    } catch {
      written()
    }
  }

  /** The same method and arguments resolve once, so asking twice costs one call. */
  const resolve = (fn, method, args) => {
    let call
    try {
      call = JSON.stringify([method, args])
    } catch {
      return Promise.resolve(UNSHAREABLE_ARGS_ANSWER)
    }

    const key = digest(call)
    const seen = answers.get(key)
    if (seen !== undefined) return seen

    const argumentBytes = storedBytes(call)
    if (!take(BYTES_PER_REMEMBERED_CALL + argumentBytes)) return Promise.resolve(OVER_MEMORY_ANSWER)

    const pending = Promise.resolve()
      .then(() => fn(...args))
      .then(serialize, error => failure(describe(error)))
      .then(text => {
        held -= argumentBytes
        return take(storedBytes(text)) ? text : OVER_MEMORY_ANSWER
      })
    answers.set(key, pending)
    return pending
  }

  subprocess.on('message', message => {
    if (!isWellFormed(message)) return
    if (!awaitReply()) return exceedMemory()
    const { id, method, args = [] } = message

    const fn = exposed.get(method)
    if (fn === undefined) return answer(id, UNKNOWN_METHOD_ANSWER)

    resolve(fn, method, args)
      .then(text => answer(id, text))
      .catch(() => {})
  })

  return { outOfMemory: () => outOfMemory }
}

module.exports = {
  attach,
  UNKNOWN_METHOD,
  UNSHAREABLE_ARGS,
  INDESCRIBABLE,
  OVER_MEMORY
}
