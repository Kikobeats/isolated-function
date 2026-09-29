'use strict'

const { EventEmitter } = require('events')
const { default: test } = require('ava')

const {
  attach,
  UNKNOWN_METHOD,
  TOO_MANY_CALLS,
  UNANSWERED_CALL,
  INDESCRIBABLE
} = require('../src/host')
const isolatedFunction = require('..')()

const NOT_AN_ERROR = null

const HOST = {
  content: async () => '<html>fetched by the host</html>',
  metadata: async () => ({ title: 'Hacker News' }),
  extract: async rules => ({ asked: Object.keys(rules) })
}

const counted = host => {
  const calls = []
  const spied = Object.fromEntries(
    Object.entries(host).map(([name, fn]) => [
      name,
      (...args) => {
        calls.push(name)
        return fn(...args)
      }
    ])
  )
  return { calls, spied }
}

const run = (snippet, host = HOST, opts = {}) => {
  const { calls, spied } = counted(host)
  return isolatedFunction(snippet, { host: spied, timeout: 20000, ...opts })().then(
    ({ value }) => ({ value, calls })
  )
}

test('a snippet that never asks costs the host nothing', async t => {
  const { value, calls } = await run(async () => 1)
  t.is(value, 1)
  t.deepEqual(calls, [])
})

test('the host resolves a method only when the snippet calls it', async t => {
  const { value, calls } = await run(async () => globalThis.__isolated_host('content'))
  t.is(value, '<html>fetched by the host</html>')
  t.deepEqual(calls, ['content'])
})

test('a call carries its arguments to the host', async t => {
  const { value, calls } = await run(async () =>
    globalThis.__isolated_host('extract', [{ title: { selector: 'h1' } }])
  )
  t.deepEqual(value, { asked: ['title'] })
  t.deepEqual(calls, ['extract'])
})

test('the same call is resolved once however often it is made', async t => {
  const { value, calls } = await run(async () => {
    const first = await globalThis.__isolated_host('content')
    const second = await globalThis.__isolated_host('content')
    return first === second
  })
  t.true(value)
  t.deepEqual(calls, ['content'])
})

test('calls differing only in their arguments are resolved separately', async t => {
  const { calls } = await run(async () => {
    await globalThis.__isolated_host('extract', [{ a: 1 }])
    await globalThis.__isolated_host('extract', [{ b: 2 }])
  })
  t.deepEqual(calls, ['extract', 'extract'])
})

test('a method the host does not expose is refused without reaching it', async t => {
  const { value, calls } = await run(async () => {
    try {
      await globalThis.__isolated_host('readFile')
    } catch (error) {
      return error.message
    }
  })
  t.is(value, UNKNOWN_METHOD)
  t.deepEqual(calls, [])
})

test('an inherited property is not a method', async t => {
  const { value } = await run(async () => {
    try {
      await globalThis.__isolated_host('constructor')
    } catch (error) {
      return error.message
    }
  })
  t.is(value, UNKNOWN_METHOD)
})

test('a failure on the host surfaces inside the snippet', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('content')
      } catch (error) {
        return error.message
      }
    },
    {
      content: async () => {
        throw new Error('every proxy tier refused')
      }
    }
  )
  t.is(value, 'every proxy tier refused')
})

test('the call budget bounds how much work a snippet can ask for', async t => {
  const { value, calls } = await run(
    async () => {
      const seen = []
      for (let index = 0; index < 4; index++) {
        try {
          seen.push(await globalThis.__isolated_host('extract', [{ [`k${index}`]: 1 }]))
        } catch (error) {
          seen.push(error.message)
        }
      }
      return seen[seen.length - 1]
    },
    HOST,
    { maxHostCalls: 2 }
  )
  t.is(value, TOO_MANY_CALLS)
  t.is(calls.length, 2)
})

test('a run without a host has no channel at all', async t => {
  const { value } = await isolatedFunction(async () => typeof process.send, {
    timeout: 20000
  })()
  t.is(value, 'undefined')
})

test('the host is not reachable from a snippet that was given no host', async t => {
  const { value } = await isolatedFunction(
    async () => (typeof globalThis.__isolated_host === 'undefined' ? 'absent' : 'present'),
    { timeout: 20000 }
  )()
  t.is(value, 'absent')
})

test('a snippet writing directly to the channel cannot invoke an unexposed method', async t => {
  const { value, calls } = await run(async () => {
    const fs = require('fs')
    fs.writeSync(3, JSON.stringify({ id: 99, method: 'readFile', args: ['/etc/passwd'] }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 300))
    return 'survived'
  })
  t.is(value, 'survived')
  t.deepEqual(calls, [])
})

test('a malformed message is ignored rather than dispatched', async t => {
  const { value, calls } = await run(async () => {
    const fs = require('fs')
    for (const forged of ['null', '{"method":"content"}', '{"id":"x","method":"content"}', '[]']) {
      fs.writeSync(3, forged + '\n')
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    return 'survived'
  })
  t.is(value, 'survived')
  t.deepEqual(calls, [])
})

test('a host exposing nothing is a mistake worth reporting', t => {
  t.throws(() => isolatedFunction(async () => 1, { host: {} }), {
    message: 'Expected `host` to expose a method'
  })
})

test('time awaiting the host is not part of the execution timeout', async t => {
  const { value } = await run(
    async () => globalThis.__isolated_host('slow'),
    { slow: () => new Promise(resolve => setTimeout(() => resolve('done'), 2500)) },
    { timeout: 1500 }
  )
  t.is(value, 'done')
})

test('a busy loop still hits the timeout while a host is attached', async t => {
  const error = await t.throwsAsync(
    isolatedFunction(
      () => {
        while (true) Date.now()
      },
      { host: HOST, timeout: 200 }
    )()
  )
  t.is(error.message, 'Execution timed out')
})

test('a call the snippet never awaits does not take the run down', async t => {
  const { value } = await run(async () => {
    globalThis.__isolated_host('content')
    return 'returned without awaiting'
  })
  t.is(value, 'returned without awaiting')
})

test('a call abandoned while the host is still working is harmless', async t => {
  const { value } = await run(
    async () => {
      globalThis.__isolated_host('slow')
      return 'returned without awaiting'
    },
    { slow: () => new Promise(resolve => setTimeout(() => resolve('late'), 1000)) }
  )
  t.is(value, 'returned without awaiting')
})

test('a value the channel cannot carry fails the call, not the run', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('big')
      } catch (error) {
        return error.message
      }
    },
    { big: async () => 1n }
  )
  t.is(value, 'Do not know how to serialize a BigInt')
})

test('a host rejecting with something other than an Error still answers', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('bad')
      } catch (error) {
        return error.message
      }
    },
    {
      bad: () =>
        Promise.resolve().then(() => {
          throw NOT_AN_ERROR
        })
    }
  )
  t.is(value, 'null')
})

test('a host resolving with nothing resolves the call with nothing', async t => {
  const { value } = await run(
    async () => {
      const answered = await globalThis.__isolated_host('none')
      return answered === undefined
    },
    { none: async () => undefined }
  )
  t.true(value)
})

test('a circular value fails its call and leaves the host standing', async t => {
  const circular = {}
  circular.self = circular
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('loop')
      } catch (error) {
        return error.message.split('\n')[0]
      }
    },
    { loop: async () => circular }
  )
  t.is(value, 'Converting circular structure to JSON')
})

test('a host throwing before it returns a promise still answers', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('boom')
      } catch (error) {
        return error.message
      }
    },
    {
      boom: () => {
        throw new Error('refused before starting')
      }
    }
  )
  t.is(value, 'refused before starting')
})

test('a rejection value that cannot even be stringified still answers', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('opaque')
      } catch (error) {
        return error.message
      }
    },
    {
      opaque: () =>
        Promise.resolve().then(() => {
          throw Object.create(null)
        })
    }
  )
  t.is(value, INDESCRIBABLE)
})

test('replacing the host closer cannot keep the channel open', async t => {
  const { value } = await run(async () => {
    globalThis.__isolated_host.close = () => {}
    return 'returned'
  })
  t.is(value, 'returned')
})

test('removing the host global cannot keep the channel open', async t => {
  const { value } = await run(async () => {
    globalThis.__isolated_host = undefined
    return 'returned'
  })
  t.is(value, 'returned')
})

test('a host call budget that is not a finite non-negative integer is refused', t => {
  const message = 'Expected `maxHostCalls` to be a finite non-negative integer'
  for (const maxHostCalls of [NaN, Infinity, -1, 1.5]) {
    t.throws(() => isolatedFunction(async () => 1, { host: HOST, maxHostCalls }), { message })
  }
})

test('a host call budget of zero reaches nothing', async t => {
  const { value, calls } = await run(
    async () => {
      try {
        return await globalThis.__isolated_host('content')
      } catch (error) {
        return error.message
      }
    },
    HOST,
    { maxHostCalls: 0 }
  )
  t.is(value, TOO_MANY_CALLS)
  t.deepEqual(calls, [])
})

test('a host method keeps the host object as its receiver', async t => {
  const host = {
    token: 'secret',
    read () {
      return this.token
    }
  }
  const { value } = await isolatedFunction(async () => globalThis.__isolated_host('read'), {
    host,
    timeout: 20000
  })()
  t.is(value, 'secret')
})

test('a method added after the run starts is refused', async t => {
  const calls = []
  const host = {
    open () {
      calls.push('open')
      host.later = () => {
        calls.push('later')
        return 'reached'
      }
      return 'opened'
    }
  }
  const { value } = await isolatedFunction(
    async () => {
      await globalThis.__isolated_host('open')
      try {
        return await globalThis.__isolated_host('later')
      } catch (error) {
        return error.message
      }
    },
    { host, timeout: 20000 }
  )()
  t.is(value, UNKNOWN_METHOD)
  t.deepEqual(calls, ['open'])
})

test('arguments that cannot be keyed do not reach the host', async t => {
  const child = new EventEmitter()
  const replies = []
  let calls = 0
  child.connected = true
  child.send = message => {
    replies.push(message)
  }
  attach(child, { ping: () => calls++ }, { maxCalls: 1 })
  const args = []
  args.push(args)
  child.emit('message', { id: 1, method: 'ping', args })
  await Promise.resolve()
  t.is(calls, 0)
  t.deepEqual(replies, [{ id: 1, failed: true, reason: TOO_MANY_CALLS }])
})

test('a host that never answers is bounded by hostCallTimeout', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('stuck')
      } catch (error) {
        return error.message
      }
    },
    { stuck: () => new Promise(() => {}) },
    { hostCallTimeout: 400 }
  )
  t.is(value, UNANSWERED_CALL)
})

test('overlapping repeats of one call stay outside the timeout', async t => {
  const { value } = await run(
    async () => {
      const first = globalThis.__isolated_host('slow')
      const second = globalThis.__isolated_host('slow')
      return (await first) + (await second)
    },
    { slow: () => new Promise(resolve => setTimeout(() => resolve('ok'), 2500)) },
    { timeout: 1500 }
  )
  t.is(value, 'okok')
})

test('a host call the snippet does not await leaves the timeout running', async t => {
  const error = await t.throwsAsync(
    isolatedFunction(
      async () => {
        globalThis.__isolated_host('stuck')
        await new Promise(resolve => setTimeout(resolve, 2500))
        return 'finished late'
      },
      { host: { stuck: () => new Promise(() => {}) }, timeout: 1500 }
    )()
  )
  t.is(error.message, 'Execution timed out')
})

test('the wall clock resumes after a host call', async t => {
  const error = await t.throwsAsync(
    isolatedFunction(
      async () => {
        await globalThis.__isolated_host('quick')
        await new Promise(resolve => setTimeout(resolve, 2500))
        return 'too late'
      },
      { host: { quick: async () => 'ok' }, timeout: 1500 }
    )()
  )
  t.is(error.message, 'Execution timed out')
})

test('a bounded call leaves the run able to continue', async t => {
  const { value } = await run(
    async () => {
      try {
        await globalThis.__isolated_host('stuck')
      } catch {
        return globalThis.__isolated_host('content')
      }
    },
    { stuck: () => new Promise(() => {}), content: async () => 'second call worked' },
    { hostCallTimeout: 300 }
  )
  t.is(value, 'second call worked')
})

test('hostCallTimeout must be a positive number', t => {
  const message = 'Expected `hostCallTimeout` to be a positive number'
  for (const hostCallTimeout of [0, -1, NaN, '400', true]) {
    t.throws(() => isolatedFunction(async () => 1, { host: HOST, hostCallTimeout }), { message })
  }
  t.notThrows(() => isolatedFunction(async () => 1, { host: HOST, hostCallTimeout: Infinity }))
})
