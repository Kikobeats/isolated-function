'use strict'

const METHOD = '__ssrf'

/* The isolate can read its own heap, so the signing key stays on the host.
   The child receives only the public half, which can check a dial and cannot approve one. */
const createKeys = () => {
  const { generateKeyPairSync } = require('node:crypto')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { privateKey, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }
}

function dialPayload (address, port, allow) {
  return `${address}\0${port ?? ''}\0${allow === true}`
}

const decision = (privateKey, address, port, allow) => {
  const { sign } = require('node:crypto')
  const value = allow === true
  return {
    allow: value,
    sig: sign(null, Buffer.from(dialPayload(address, port, value)), privateKey).toString('base64')
  }
}

const install = (method, publicKey, encode) => {
  const net = require('node:net')
  const dns = require('node:dns')
  const { verify, createPublicKey } = require('node:crypto')
  const key = createPublicKey(publicKey)
  const request = process.send.bind(process)
  const pending = new Map()
  let id = 0

  const accepted = (address, port, allow, signature) => {
    if (typeof signature !== 'string' || signature.length === 0) return false
    try {
      return verify(
        null,
        Buffer.from(encode(address, port, allow)),
        key,
        Buffer.from(signature, 'base64')
      )
    } catch {
      return false
    }
  }

  process.on('message', reply => {
    if (!reply || !pending.has(reply.id)) return
    const waiting = pending.get(reply.id)
    const body = reply.value
    if (body === null || typeof body !== 'object') return
    const allow = body.allow === true
    if (!accepted(waiting.address, waiting.port, allow, body.sig)) return
    pending.delete(reply.id)
    waiting.resolve(allow)
  })

  const portOf = port => {
    if (port == null || port === '') return null
    if (typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535) {
      return port
    }
    if (typeof port === 'string' && port.trim() !== '') {
      const value = +port
      if (value === value >>> 0 && value <= 65535) return value
    }
    return port
  }

  const ask = (address, port) =>
    new Promise((resolve, reject) => {
      const messageId = --id
      const canonical = portOf(port)
      pending.set(messageId, { resolve, reject, address, port: canonical })
      try {
        request({ id: messageId, method, args: [address, canonical] }, error => {
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

const prelude = publicKey =>
  `;(${install.toString()})(${JSON.stringify(METHOD)},${JSON.stringify(
    publicKey
  )},${dialPayload.toString()});\n`

module.exports = { METHOD, prelude, createKeys, decision }
