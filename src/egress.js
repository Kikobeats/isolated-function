'use strict'

const METHOD = '__ssrf'

const install = method => {
  const net = require('node:net')
  const dns = require('node:dns')
  const pending = new Map()
  let id = 0

  process.on('message', reply => {
    if (!reply || !pending.has(reply.id)) return
    const waiting = pending.get(reply.id)
    pending.delete(reply.id)
    if (reply.failed) waiting.reject(new Error(reply.reason))
    else waiting.resolve(reply.value)
  })

  const ask = (address, port) =>
    new Promise((resolve, reject) => {
      const messageId = --id
      pending.set(messageId, { resolve, reject })
      try {
        process.send({ id: messageId, method, args: [address, port] }, error => {
          if (!error) return
          pending.delete(messageId)
          reject(error)
        })
      } catch (error) {
        pending.delete(messageId)
        reject(error)
      }
    })

  const refused = host =>
    Object.assign(new Error(`The url \`${host}\` is not resolving to unicast IP address`), {
      code: 'ERESERVEDADDRESSRANGE'
    })

  const orig = net.Socket.prototype.connect
  function connect (...args) {
    const head = args[0]
    const options = Array.isArray(head)
      ? head[0]
      : head !== null && typeof head === 'object'
        ? head
        : null
    let host
    let port
    let path
    if (options) {
      host = options.host
      port = options.port
      path = options.path
    } else if (typeof head === 'string') {
      path = head
    } else {
      port = head
      host = typeof args[1] === 'string' ? args[1] : undefined
    }
    if (typeof host === 'string' && host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }

    const deny = () => {
      process.nextTick(() => {
        if (!this.destroyed) this.destroy(refused(path || host || ''))
      })
      return this
    }

    if (path) return deny()

    if (net.isIP(host)) {
      ask(host, port).then(
        answer => {
          if (answer !== true || this.destroyed) {
            if (!this.destroyed) this.destroy(refused(host))
            return
          }
          orig.apply(this, args)
        },
        () => {
          if (!this.destroyed) this.destroy(refused(host))
        }
      )
      return this
    }

    const previous = (options && options.lookup) || dns.lookup
    const lookup = (hostname, lookupOptions, callback) => {
      previous(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
        if (error) return callback(error)
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses }]
        if (list.length === 0) return callback(refused(hostname))
        Promise.all(list.map(entry => ask(entry.address, port)))
          .then(answers => {
            if (answers.some(answer => answer !== true)) return callback(refused(hostname))
            if (lookupOptions && lookupOptions.all) return callback(null, list)
            callback(null, list[0].address, list[0].family)
          })
          .catch(() => callback(refused(hostname)))
      })
    }

    if (options) options.lookup = lookup
    const cb = options ? args[1] : typeof args[1] === 'function' ? args[1] : args[2]
    const forwarded = options ? args : [{ port, host, lookup }, cb]
    return orig.apply(this, forwarded)
  }

  Object.defineProperty(net.Socket.prototype, 'connect', {
    configurable: false,
    enumerable: true,
    value: connect,
    writable: false
  })
}

const prelude = () => `;(${install.toString()})(${JSON.stringify(METHOD)});\n`

module.exports = { METHOD, prelude }
