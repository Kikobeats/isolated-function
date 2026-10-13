'use strict'

const net = require('node:net')

/**
 * Same non-unicast ranges `ipaddr.js` `range() === 'unicast'` refuses. The
 * child cannot `require` this file under `--permission`, so `prelude` inlines
 * `install` and the list travels inside it.
 *
 * IPv4-mapped IPv6 is left to `BlockList`, which checks the embedded IPv4.
 * Adding `::ffff:0:0/96` would refuse public addresses written in that form.
 */
const RANGES = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.31.196.0', 24, 'ipv4'],
  ['192.52.193.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['192.175.48.0', 24, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2001::', 23, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:3::', 32, 'ipv6'],
  ['2001:4:112::', 48, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:20::', 28, 'ipv6'],
  ['2001:30::', 28, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['2620:4f:8000::', 48, 'ipv6'],
  ['3fff::', 20, 'ipv6'],
  ['5f00::', 16, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6']
]

const KEY = '/'

const parseEgress = entry => {
  if (typeof entry !== 'string') return undefined
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(entry)
  const plain = /^([^:]+):(\d+)$/.exec(entry)
  const match = bracketed || plain
  if (!match) return undefined
  const host = match[1]
  const port = match[2]
  if (net.isIP(host) === 0) return undefined
  return `${host}${KEY}${port}`
}

const normalizeEgress = entries => {
  if (entries === undefined) return []
  if (!Array.isArray(entries)) throw new TypeError('Expected `allow.egress` to be an array')
  return entries.map(entry => {
    const key = parseEgress(entry)
    if (key === undefined) throw new TypeError('Expected `allow.egress` entries to be `ip:port`')
    return key
  })
}

const install = (allowlist, ranges) => {
  const net = require('node:net')
  const dns = require('node:dns')
  const block = new net.BlockList()
  for (const [address, prefix, family] of ranges) block.addSubnet(address, prefix, family)

  const allowed = new Set(allowlist)
  const isBlocked = address => {
    const version = net.isIP(address)
    if (version === 0) return false
    return block.check(address, version === 6 ? 'ipv6' : 'ipv4')
  }
  const refused = host =>
    Object.assign(new Error(`The url \`${host}\` is not resolving to unicast IP address`), {
      code: 'ERESERVEDADDRESSRANGE'
    })
  const allowedKey = (host, port) => allowed.has(`${host}/${port}`)

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
      process.nextTick(() => this.destroy(refused(path || host || '')))
      return this
    }

    if (path) return deny()
    if (net.isIP(host)) {
      if (isBlocked(host) && !allowedKey(host, port)) return deny()
      return orig.apply(this, args)
    }

    const previous = (options && options.lookup) || dns.lookup
    const lookup = (hostname, lookupOptions, callback) => {
      previous(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
        if (err) return callback(err)
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses }]
        if (list.length === 0 || list.some(entry => isBlocked(entry.address))) {
          return callback(refused(hostname))
        }
        if (lookupOptions.all) return callback(null, list)
        callback(null, list[0].address, list[0].family)
      })
    }

    if (options) {
      options.lookup = lookup
      return orig.apply(this, args)
    }

    const cb = typeof args[1] === 'function' ? args[1] : args[2]
    return orig.call(this, { port, host, lookup }, cb)
  }

  Object.defineProperty(net.Socket.prototype, 'connect', {
    configurable: false,
    enumerable: true,
    value: connect,
    writable: false
  })
}

const prelude = entries => {
  if (entries === undefined) return ''
  return `;(${install.toString()})(${JSON.stringify(normalizeEgress(entries))},${JSON.stringify(
    RANGES
  )});\n`
}

module.exports = { install, normalizeEgress, parseEgress, prelude, RANGES }
