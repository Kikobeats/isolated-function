'use strict'

const { CHANNEL } = require('./channel')

const HOST_CALL = 'globalThis.__isolated_host'
const CLOSE_HOST = 'closeIsolatedHost'

/* The template calls the returned closer. The snippet can replace the global
   or `call.close` and must not be able to keep the channel open. */
const source = methods => `
    const ${CLOSE_HOST} = (() => {
      const request = ${CHANNEL}.send
      const disconnect = ${CHANNEL}.close
      const pending = new Map()
      let lastId = 0
      let closed = false

      const settle = reason => {
        for (const waiting of pending.values()) waiting.reject(new Error(reason))
        pending.clear()
      }

      ${CHANNEL}.onMessage(reply => {
        const waiting = pending.get(reply && reply.id)
        if (waiting === undefined) return
        pending.delete(reply.id)
        reply.failed ? waiting.reject(new Error(reply.reason)) : waiting.resolve(reply.value)
      })

      ${CHANNEL}.onClose(() => {
        closed = true
        settle('the host channel closed before answering')
      })

      const call = (method, args) => {
        const answer = new Promise((resolve, reject) => {
          if (closed) return reject(new Error('the host channel is already closed'))
          const id = ++lastId
          pending.set(id, { resolve, reject })
          request({ id, method, args })
        })
        /* A call the snippet starts but never awaits must not take the run down
           with an unhandled rejection; awaiting it still surfaces the error. */
        answer.catch(() => {})
        return answer
      }

      const close = () => {
        if (closed) return
        closed = true
        settle('the host channel closed')
        disconnect()
      }

      call.methods = ${JSON.stringify(methods)}
      call.close = close
      ${HOST_CALL} = call
      return close
    })()`

module.exports = { source, CLOSE_HOST }
