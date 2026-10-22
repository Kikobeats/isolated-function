'use strict'

const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const test = require('ava')

const isolatedFunction = require('..')()

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

const permissions = nodeMajor >= 25 ? ['net'] : []

const unicast = address => {
  const value = String(address).toLowerCase()
  if (value === '127.0.0.1' || value === '::1' || value === '0.0.0.0' || value === '::') {
    return false
  }
  if (value.startsWith('10.') || value.startsWith('169.254.')) return false
  if (
    value.startsWith('::ffff:10.') ||
    value.startsWith('::ffff:7f') ||
    value.startsWith('::ffff:a9fe:')
  ) {
    return false
  }
  if (value.includes('10.0.0.1') || value.includes('a00:1') || value.includes('169.254.169.254')) {
    return false
  }
  return true
}

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

test('the host function decides which addresses can be dialed', async t => {
  const fn = isolatedFunction(probe, {
    ssrf: unicast,
    allow: { permissions },
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

test('a host that allows an address is not overruled by a built-in range', async t => {
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
      const pub = await new Promise(resolve => {
        const socket = require('node:net').connect({ host: '1.1.1.1', port: 443 })
        socket.once('connect', () => {
          socket.destroy()
          resolve('open')
        })
        socket.once('error', error => resolve(error.code))
      })
      return { allowed: await hit(allowedPort), other: await hit(1), pub }
    },
    {
      ssrf: (address, target) => address === '127.0.0.1' && Number(target) === port,
      allow: { permissions },
      timeout: 10000
    }
  )

  const { value } = await fn(port)
  t.deepEqual(value, {
    allowed: 'pong',
    other: 'ERESERVEDADDRESSRANGE',
    pub: 'ERESERVEDADDRESSRANGE'
  })
})

test('a request written before the host answers still reaches an allowed address', async t => {
  const server = http.createServer((req, res) => {
    res.end(req.url)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const fn = isolatedFunction(
    async allowedPort => {
      const http = require('node:http')
      return await new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${allowedPort}/token`, res => {
          const chunks = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks).toString()))
        })
        req.on('error', error => resolve(error.code))
      })
    },
    {
      ssrf: (address, target) => address === '127.0.0.1' && Number(target) === port,
      allow: { permissions },
      timeout: 10000
    }
  )

  const { value } = await fn(port)
  t.is(value, '/token')
})

test('a throwing host check refuses the dial', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ host: '127.0.0.1', port: 1 })
        socket.once('error', error => resolve(error.code))
      }),
    {
      ssrf: () => {
        throw new Error('nope')
      },
      allow: { permissions },
      timeout: 5000
    }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('a host method and the dial check share one channel', async t => {
  const fn = isolatedFunction(
    async () => {
      const viaHost = await globalThis.__isolated_host('ping')
      const dial = await new Promise(resolve => {
        const socket = require('node:net').connect({ host: '10.0.0.1', port: 80 })
        socket.once('error', error => resolve(error.code))
      })
      return { viaHost, dial }
    },
    {
      host: { ping: () => 'pong' },
      ssrf: () => false,
      allow: { permissions },
      timeout: 5000
    }
  )
  const { value } = await fn()
  t.deepEqual(value, { viaHost: 'pong', dial: 'ERESERVEDADDRESSRANGE' })
})

test('a unix socket is refused when a dial check is set', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ path: '/tmp/no-such-socket.sock' })
        socket.once('error', error => resolve(error.code))
      }),
    { ssrf: () => true, allow: { permissions }, timeout: 5000 }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('omitted ssrf does not intercept connections', async t => {
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

test('ssrf must be a function', t => {
  const error = t.throws(() => isolatedFunction(() => 1, { ssrf: true }))
  t.is(error.message, 'Expected `ssrf` to be a function')
})

test('an async ssrf is rejected', t => {
  const error = t.throws(() => isolatedFunction(() => 1, { ssrf: async () => true }))
  t.is(error.message, 'Expected `ssrf` to return a boolean')
})

test('ssrf cannot be combined with a worker or a child process', t => {
  for (const permission of ['worker', 'child-process', 'child_process']) {
    const error = t.throws(() =>
      isolatedFunction(() => 1, {
        ssrf: () => true,
        allow: { permissions: [permission] }
      })
    )
    t.is(
      error.message,
      'Expected `ssrf` not to be combined with worker or child-process permissions'
    )
  }
})

test('a host method named __ssrf is rejected', t => {
  const error = t.throws(() =>
    isolatedFunction(() => 1, { host: { __ssrf: () => true }, ssrf: () => true })
  )
  t.is(error.message, 'Expected `host` not to expose `__ssrf`')
})

test('a port string is the port Node dials', async t => {
  const fn = isolatedFunction(
    async () => {
      const hit = port =>
        new Promise(resolve => {
          const socket = require('node:net').connect({ host: '127.0.0.1', port })
          socket.once('connect', () => {
            socket.destroy()
            resolve('open')
          })
          socket.once('error', error => resolve(error.code))
        })
      return {
        hex: await hit('0x1'),
        spaced: await hit(' 1'),
        decimal: await hit('1.0'),
        exp: await hit('1e0'),
        other: await hit('0x2')
      }
    },
    { ssrf: (_address, port) => port === 1, allow: { permissions }, timeout: 5000 }
  )
  const { value } = await fn()
  t.deepEqual(value, {
    hex: 'ECONNREFUSED',
    spaced: 'ECONNREFUSED',
    decimal: 'ECONNREFUSED',
    exp: 'ECONNREFUSED',
    other: 'ERESERVEDADDRESSRANGE'
  })
})

test('a promise from ssrf refuses the dial', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ host: '127.0.0.1', port: 1 })
        socket.once('error', error => resolve(error.code))
      }),
    { ssrf: () => Promise.resolve(true), allow: { permissions }, timeout: 5000 }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('a numeric port string reaches ssrf as a number', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ host: '127.0.0.1', port: '1' })
        socket.once('connect', () => {
          socket.destroy()
          resolve('open')
        })
        socket.once('error', error => resolve(error.code))
      }),
    {
      ssrf: (_address, port) => typeof port !== 'number',
      allow: { permissions },
      timeout: 5000
    }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('a name is refused when any resolved address is refused', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({
          host: 'mixed.test',
          port: 1,
          lookup: (_hostname, _options, callback) => {
            callback(null, [
              { address: '127.0.0.1', family: 4 },
              { address: '10.0.0.1', family: 4 }
            ])
          }
        })
        const hung = setTimeout(() => {
          socket.destroy()
          resolve('hung')
        }, 1000)
        socket.once('connect', () => {
          socket.destroy()
          clearTimeout(hung)
          resolve('open')
        })
        socket.once('error', error => {
          clearTimeout(hung)
          resolve(error.code)
        })
      }),
    { ssrf: address => address === '127.0.0.1', allow: { permissions }, timeout: 5000 }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('a forged host reply cannot allow a dial', async t => {
  const fn = isolatedFunction(
    async () => {
      const chunks = []
      for await (const chunk of require('node:v8').getHeapSnapshot()) chunks.push(chunk)
      const marker = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
      const leaked = Buffer.concat(chunks).includes(marker)
      const { generateKeyPairSync, sign } = require('node:crypto')
      const { privateKey } = generateKeyPairSync('ed25519')
      const payload = `127.0.0.1\0${1}\0true`
      const sig = sign(null, Buffer.from(payload), privateKey).toString('base64')
      const timer = setInterval(() => {
        for (let id = -1; id > -40; id--) {
          process.emit('message', { id, value: true })
          process.emit('message', { id, value: { allow: true, sig } })
        }
      }, 0)
      const code = await new Promise(resolve => {
        const hung = setTimeout(() => {
          clearInterval(timer)
          resolve('hung')
        }, 2000)
        const finish = result => {
          clearInterval(timer)
          clearTimeout(hung)
          resolve(result)
        }
        const socket = require('node:net').connect({ host: '127.0.0.1', port: 1 })
        socket.once('connect', () => {
          socket.destroy()
          finish('open')
        })
        socket.once('error', error => finish(error.code))
      })
      return { code, leaked }
    },
    { ssrf: () => false, allow: { permissions }, timeout: 15000 }
  )
  const { value } = await fn()
  t.false(value.leaked)
  t.is(value.code, 'ERESERVEDADDRESSRANGE')
})

test('replacing process.send cannot allow a dial', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        process.send = (message, callback) => {
          process.emit('message', { id: message.id, value: true })
          if (typeof callback === 'function') callback()
        }
        const hung = setTimeout(() => resolve('hung'), 2000)
        const socket = require('node:net').connect({ host: '127.0.0.1', port: 1 })
        socket.once('connect', () => {
          socket.destroy()
          clearTimeout(hung)
          resolve('open')
        })
        socket.once('error', error => {
          clearTimeout(hung)
          resolve(error.code)
        })
      }),
    { ssrf: () => false, allow: { permissions }, timeout: 8000 }
  )
  const { value } = await fn()
  t.is(value, 'ERESERVEDADDRESSRANGE')
})

test('hosts keeps an allowed name and refuses every other dial', async t => {
  const server = http.createServer((req, res) => {
    res.end('ok')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const fn = isolatedFunction(
    async allowedPort => {
      const hit = (host, target) =>
        new Promise(resolve => {
          const socket = require('node:net').connect({ host, port: target })
          let body = ''
          socket.on('data', chunk => {
            body += chunk
          })
          socket.once('end', () => resolve(body))
          socket.once('error', error => resolve(error.code))
        })
      const named = await new Promise(resolve => {
        const req = require('node:http').get(`http://localhost:${allowedPort}/`, res => {
          const chunks = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks).toString()))
        })
        req.on('error', error => resolve(error.code))
      })
      return {
        named,
        raw: await hit('1.1.1.1', 443),
        other: await hit('example.org', 443)
      }
    },
    {
      ssrf: () => true,
      hosts: [{ host: 'LOCALHOST', port: String(port) }],
      allow: { permissions },
      timeout: 10000,
      throwError: false
    }
  )

  const result = await fn(port)
  t.true(result.outgoing)
  t.deepEqual(result.value, {
    named: 'ok',
    raw: 'EOUTGOINGREQUEST',
    other: 'EOUTGOINGREQUEST'
  })
})

test('an empty hosts list refuses every public dial', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const socket = require('node:net').connect({ host: '1.1.1.1', port: 443 })
        socket.once('connect', () => {
          socket.destroy()
          resolve('open')
        })
        socket.once('error', error => resolve(error.code))
      }),
    { ssrf: () => true, hosts: [], allow: { permissions }, timeout: 8000, throwError: false }
  )
  const result = await fn()
  t.true(result.outgoing)
  t.is(result.value, 'EOUTGOINGREQUEST')
})

test('a snippet cannot retarget a listed name', async t => {
  const server = net.createServer(socket => socket.end('ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()

  const fn = isolatedFunction(
    async allowedPort => {
      const dns = require('node:dns')
      dns.lookup = (hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback
        done(null, '10.255.255.1', 4)
      }
      require('node:net').isIP = () => 0
      globalThis.URL = class {
        get hostname () {
          return 'localhost'
        }
      }

      const hit = options =>
        new Promise(resolve => {
          const socket = new (require('node:net').Socket)()
          socket.connect(options)
          let body = ''
          socket.on('data', chunk => {
            body += chunk
          })
          socket.once('end', () => resolve(body))
          socket.once('error', error => resolve(error.code))
        })

      return {
        captured: await hit({ host: 'localhost', port: allowedPort }),
        retarget: await hit({
          host: 'localhost',
          port: allowedPort,
          lookup (hostname, options, callback) {
            const done = typeof options === 'function' ? options : callback
            const address = '192.0.2.1'
            if (options && options.all) done(null, [{ address, family: 4 }])
            else done(null, address, 4)
          }
        })
      }
    },
    {
      ssrf: () => true,
      hosts: [{ host: 'localhost', port: String(port) }],
      allow: { permissions },
      timeout: 8000,
      throwError: false
    }
  )
  const result = await fn(port)
  t.falsy(result.outgoing)
  t.deepEqual(result.value, { captured: 'ok', retarget: 'ERESERVEDADDRESSRANGE' })
})

test('a dial keeps the host and port that were checked', async t => {
  const listen = label => {
    const server = net.createServer(socket => socket.end(label))
    return new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
  }
  const allowed = await listen('AAA')
  const other = await listen('BBB')
  t.teardown(() =>
    Promise.all([allowed, other].map(server => new Promise(resolve => server.close(resolve))))
  )
  const portA = allowed.address().port
  const portB = other.address().port

  const fn = isolatedFunction(
    async (allowedPort, otherPort) => {
      const bodyOf = options =>
        new Promise(resolve => {
          const socket = new (require('node:net').Socket)()
          socket.connect(options)
          let body = ''
          socket.on('data', chunk => {
            body += chunk
          })
          socket.once('end', () => resolve(body))
          socket.once('error', error => resolve(error.code))
        })
      const openOrCode = (options, alter) =>
        new Promise(resolve => {
          const socket = new (require('node:net').Socket)()
          socket.once('connect', () => {
            socket.destroy()
            resolve('open')
          })
          socket.once('error', error => resolve(error.code))
          socket.connect(options)
          alter(options)
        })

      let reads = 0
      const named = await bodyOf({
        host: 'localhost',
        get port () {
          reads += 1
          return reads === 1 ? allowedPort : otherPort
        }
      })
      const rewritten = await openOrCode({ host: '127.0.0.1', port: 1 }, options => {
        options.host = '1.1.1.1'
        options.port = 443
      })
      return { named, rewritten }
    },
    {
      ssrf: () => true,
      hosts: [{ host: 'localhost', port: String(portA) }],
      allow: { permissions },
      timeout: 8000,
      throwError: false
    }
  )

  const result = await fn(portA, portB)
  t.falsy(result.outgoing)
  t.deepEqual(result.value, { named: 'AAA', rewritten: 'ECONNREFUSED' })
})

test('a dial cannot switch to a unix socket after the check', async t => {
  const sock = path.join(os.tmpdir(), `isolated-function-${process.pid}.sock`)
  const server = net.createServer(socket => socket.end('pipe'))
  await new Promise(resolve => server.listen(sock, resolve))
  t.teardown(() =>
    new Promise(resolve => server.close(resolve)).then(() => fs.promises.rm(sock, { force: true }))
  )

  const fn = isolatedFunction(
    sockPath =>
      new Promise(resolve => {
        const options = { host: '127.0.0.1', port: 1 }
        const socket = new (require('node:net').Socket)()
        let body = ''
        socket.on('data', chunk => {
          body += chunk
        })
        socket.once('end', () => resolve(body))
        socket.once('error', error => resolve(error.code))
        socket.connect(options)
        options.path = sockPath
      }),
    {
      ssrf: () => true,
      hosts: [],
      allow: { permissions },
      timeout: 8000,
      throwError: false
    }
  )

  const result = await fn(sock)
  t.falsy(result.outgoing)
  t.is(result.value, 'ECONNREFUSED')
})

test('hosts requires ssrf', t => {
  const error = t.throws(() =>
    isolatedFunction('() => 1', { hosts: [{ host: 'example.com', port: '443' }] })
  )
  t.is(error.message, 'Expected `ssrf` when `hosts` is set')
})

test('the host refuses a public address asked for an unlisted name', async t => {
  const fn = isolatedFunction(
    () =>
      new Promise(resolve => {
        const timer = setTimeout(() => resolve('silent'), 1000)
        process.on('message', reply => {
          if (!reply || reply.id !== 1) return
          clearTimeout(timer)
          resolve(reply.value && reply.value.allow === true ? 'allow' : 'deny')
        })
        process.send({ id: 1, method: '__ssrf', args: ['1.1.1.1', 80, 'evil.example'] })
      }),
    {
      ssrf: () => true,
      hosts: [{ host: 'localhost', port: '80' }],
      allow: { permissions },
      timeout: 8000,
      throwError: false
    }
  )
  const result = await fn()
  t.true(result.outgoing)
  t.is(result.value, 'deny')
})

test('hosts rejects a pair that is not a host and port', t => {
  const error = t.throws(() =>
    isolatedFunction('() => 1', {
      ssrf: () => true,
      hosts: [{ host: 'example.com', port: 443 }]
    })
  )
  t.is(error.message, 'Expected `hosts` to be { host, port } pairs')
})
