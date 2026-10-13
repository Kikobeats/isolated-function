'use strict'

const net = require('node:net')
const test = require('ava')

const { normalizeEgress } = require('../src/egress')
const isolatedFunction = require('..')()

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

const permissions = nodeMajor >= 25 ? ['net'] : []

const probe = `
async () => {
  const net = require('node:net')
  try {
    net.Socket.prototype.connect = function () { return this }
  } catch {}

  const hit = (host, port) => new Promise(resolve => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve('open')
    })
    socket.once('error', error => resolve(error.code))
  })

  const viaFetch = async url => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      return response.status
    } catch (error) {
      return (error.cause && error.cause.code) || error.code || error.name
    }
  }

  return {
    loopback: await hit('127.0.0.1', 1),
    private: await hit('10.0.0.1', 80),
    metadata: await viaFetch('http://169.254.169.254/'),
    mapped: await hit('::ffff:10.0.0.1', 80),
    localhost: await hit('localhost', 1),
    decimal: await viaFetch('http://2130706433/'),
    example: await viaFetch('https://example.com/')
  }
}
`

test('refuses reserved addresses and still reaches a public host', async t => {
  const fn = isolatedFunction(probe, {
    allow: { permissions, egress: [] },
    timeout: 20000
  })
  const { value } = await fn()
  t.deepEqual(value, {
    loopback: 'ERESERVEDADDRESSRANGE',
    private: 'ERESERVEDADDRESSRANGE',
    metadata: 'ERESERVEDADDRESSRANGE',
    mapped: 'ERESERVEDADDRESSRANGE',
    localhost: 'ERESERVEDADDRESSRANGE',
    decimal: 'ERESERVEDADDRESSRANGE',
    example: 200
  })
})

test('an allowlisted loopback port answers and any other loopback port is refused', async t => {
  const server = net.createServer(socket => socket.end('pong'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const fn = isolatedFunction(
    async allowedPort => {
      const hit = target =>
        new Promise(resolve => {
          const socket = require('node:net').connect({ host: '127.0.0.1', port: target })
          let body = ''
          socket.on('data', chunk => {
            body += chunk
          })
          socket.once('end', () => resolve(body))
          socket.once('error', error => resolve(error.code))
        })
      return { allowed: await hit(allowedPort), other: await hit(1) }
    },
    {
      allow: { permissions, egress: [`127.0.0.1:${port}`] },
      timeout: 10000
    }
  )

  const { value } = await fn(port)
  t.deepEqual(value, { allowed: 'pong', other: 'ERESERVEDADDRESSRANGE' })
})

test('omitted egress does not intercept connections', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ host: '127.0.0.1', port: 1 })
        socket.once('error', error => resolve(error.code))
      }),
    { allow: { permissions }, timeout: 5000 }
  )
  const { value } = await fn()
  t.is(value, 'ECONNREFUSED')
})

test('allow.egress rejects a hostname', t => {
  const error = t.throws(() => normalizeEgress(['localhost:80']))
  t.is(error.message, 'Expected `allow.egress` entries to be `ip:port`')
})
