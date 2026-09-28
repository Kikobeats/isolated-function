'use strict'

const HOST_CALL = 'globalThis.__isolated_host'

const source = methods => `
    ${HOST_CALL} = (() => {
      const request = process.send.bind(process)
      const close = process.disconnect.bind(process)
      const pending = new Map()
      let lastId = 0
      let closed = false

      process.on('message', reply => {
        const waiting = pending.get(reply && reply.id)
        if (waiting === undefined) return
        pending.delete(reply.id)
        reply.failed ? waiting.reject(new Error(reply.reason)) : waiting.resolve(reply.value)
      })

      const call = (method, args) => new Promise((resolve, reject) => {
        if (closed) return reject(new Error('the host channel is already closed'))
        const id = ++lastId
        pending.set(id, { resolve, reject })
        request({ id, method, args })
      })

      call.methods = ${JSON.stringify(methods)}
      call.close = () => {
        if (closed) return
        closed = true
        for (const { reject } of pending.values()) reject(new Error('the host channel closed'))
        pending.clear()
        close()
      }
      return call
    })()`

module.exports = { source, HOST_CALL }
