'use strict'

const { EventEmitter } = require('events')
const { execFileSync } = require('child_process')
const { default: test } = require('ava')

const {
  attach,
  UNKNOWN_METHOD,
  UNSHAREABLE_ARGS,
  INDESCRIBABLE,
  OVER_MEMORY
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
  attach(child, { ping: () => calls++ })
  const args = []
  args.push(args)
  child.emit('message', { id: 1, method: 'ping', args })
  await Promise.resolve()
  t.is(calls, 0)
  t.deepEqual(replies, [{ id: 1, failed: true, reason: UNSHAREABLE_ARGS }])
})

const fakeChild = () => {
  const child = new EventEmitter()
  const replies = []
  child.connected = true
  child.send = (message, written) => {
    replies.push(message)
    written()
  }
  return { child, replies }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

const retainedBytes = ({ host, argsOf, calls, memory }) =>
  Number(
    execFileSync(process.execPath, [
      '--expose-gc',
      '-e',
      `
      const { EventEmitter } = require('events')
      const { attach } = require(${JSON.stringify(require.resolve('../src/host'))})
      const child = new EventEmitter()
      child.connected = true
      child.send = (message, written) => written()
      attach(child, { call: ${host} }, { memory: ${memory} })
      const argsOf = ${argsOf}
      global.gc()
      const before = process.memoryUsage().heapUsed
      for (let id = 0; id < ${calls}; id++) {
        child.emit('message', { id, method: 'call', args: argsOf(id) })
      }
      setImmediate(() => setImmediate(() => {
        global.gc()
        process.stdout.write(String(process.memoryUsage().heapUsed - before))
      }))
      `
    ])
  )

const MEMORY_MB = 8
const withinMemory = (t, bytes) =>
  t.true(bytes < (MEMORY_MB + 2) * 1024 * 1024, `${bytes} bytes retained`)

test('large arguments are not kept once their call is answered', t => {
  withinMemory(
    t,
    retainedBytes({
      host: "async () => 'html'",
      argsOf: "id => ['x'.repeat(4 * 1024 * 1024) + id]",
      calls: 40,
      memory: 'undefined'
    })
  )
})

test('what a failed call threw is not kept beyond the memory', t => {
  withinMemory(
    t,
    retainedBytes({
      host: 'input => new URL(input).href',
      argsOf: "id => ['x'.repeat(1024 * 1024) + id]",
      calls: 40,
      memory: MEMORY_MB
    })
  )
})

test('arguments of calls still running count against the memory', t => {
  withinMemory(
    t,
    retainedBytes({
      host: 'async input => { await new Promise(resolve => setTimeout(resolve, 60000).unref()); return input }',
      argsOf: "id => ['x'.repeat(64 * 1024) + id]",
      calls: 1000,
      memory: MEMORY_MB
    })
  )
})

test('results that weigh more in memory than their size are kept as their answer', t => {
  withinMemory(
    t,
    retainedBytes({
      host: 'rows => Array.from({ length: rows }, () => ({}))',
      argsOf: 'id => [100000 + id]',
      calls: 200,
      memory: MEMORY_MB
    })
  )
})

test('wide characters are charged for the bytes they take', t => {
  withinMemory(
    t,
    retainedBytes({
      host: "id => '語'.repeat(512 * 1024) + id",
      argsOf: 'id => [id]',
      calls: 40,
      memory: MEMORY_MB
    })
  )
})

const ONE_MB = 1024 * 1024
const megabyteResult = n => 'x'.repeat(ONE_MB) + n
const replyTo = (replies, id) => replies.find(reply => reply.id === id)
const refused = id => ({ id, failed: true, reason: OVER_MEMORY })

test('the results a run keeps stay within its memory, and repeats still answer', async t => {
  const { child, replies } = fakeChild()
  attach(child, { big: megabyteResult }, { memory: 4 })

  for (let id = 1; id <= 6; id++) child.emit('message', { id, method: 'big', args: [id] })
  await settle()
  child.emit('message', { id: 7, method: 'big', args: [1] })
  await settle()

  for (const id of [1, 2, 3]) {
    t.is(replyTo(replies, id).value, megabyteResult(id))
  }
  for (const id of [4, 5, 6]) {
    t.deepEqual(replyTo(replies, id), refused(id))
  }
  t.is(replyTo(replies, 7).value, megabyteResult(1))
})

test('answers that fill the memory exactly are kept', async t => {
  const { child, replies } = fakeChild()
  const answerWrapping = JSON.stringify({ value: '' }).length
  const halfFit = 'x'.repeat(ONE_MB / 2 - 256 - answerWrapping)
  attach(child, { fill: () => halfFit }, { memory: 1 })

  child.emit('message', { id: 1, method: 'fill', args: [1] })
  child.emit('message', { id: 2, method: 'fill', args: [2] })
  await settle()

  t.is(replyTo(replies, 1).value, halfFit)
  t.is(replyTo(replies, 2).value, halfFit)
})

test('repeating a large answer many times at once still answers every call', async t => {
  const config = { flags: { a: true }, blob: 'x'.repeat(300 * 1024) }
  const fn = isolatedFunction(
    async () => {
      const host = globalThis.__isolated_host
      const flags = await Promise.all(
        Array.from({ length: 300 }, () => host('config').then(answer => answer.flags.a))
      )
      return flags.every(flag => flag === true)
    },
    { host: { config: () => config }, memory: 64, timeout: 10000 }
  )
  const { isFulfilled, value } = await fn()
  t.true(isFulfilled)
  t.true(value)
})

test('a string stored two bytes per character is charged for both', t => {
  withinMemory(
    t,
    retainedBytes({
      host: "id => 'x'.repeat(64 * 1024) + 'Ā' + id",
      argsOf: 'id => [id]',
      calls: 512,
      memory: MEMORY_MB
    })
  )
})

test('a run without memory keeps every result', async t => {
  const { child, replies } = fakeChild()
  attach(child, { big: megabyteResult })

  for (let id = 1; id <= 6; id++) child.emit('message', { id, method: 'big', args: [id] })
  await settle()

  t.deepEqual(
    replies.map(reply => reply.failed),
    Array(6).fill(undefined)
  )
})

test('remembering a call costs memory even when its result is empty', async t => {
  const { child, replies } = fakeChild()
  let calls = 0
  attach(
    child,
    {
      ping: () => {
        calls++
      }
    },
    { memory: 1 }
  )

  const callsAtMostThatFit = ONE_MB / 256
  const batch = 1000
  for (let id = 0; id < callsAtMostThatFit; id++) {
    child.emit('message', { id, method: 'ping', args: [id] })
    if (id % batch === 0) await settle()
  }
  await settle()

  const refusedReplies = replies.filter(reply => reply.failed)
  t.true(refusedReplies.length > 0)
  t.true(refusedReplies.every(reply => reply.reason === OVER_MEMORY))
  t.is(calls + refusedReplies.length, callsAtMostThatFit)
})

test('the memory option reaches the host channel', async t => {
  const fn = isolatedFunction(
    async () => {
      const host = globalThis.__isolated_host
      const calls = Array.from({ length: 10 }, (_, n) =>
        host('big', [n]).then(
          () => true,
          error => error.message
        )
      )
      return Promise.all(calls)
    },
    { host: { big: n => 'x'.repeat(4 * ONE_MB) + n }, memory: 32, timeout: 10000 }
  )
  const { value } = await fn()
  t.deepEqual(value, [...Array(7).fill(true), ...Array(3).fill(OVER_MEMORY)])
})

test('calls whose arguments differ only in a long tail are still told apart', async t => {
  const { child, replies } = fakeChild()
  attach(child, { echo: tail => tail.slice(-1) })
  const prefix = 'x'.repeat(1024 * 1024)

  child.emit('message', { id: 1, method: 'echo', args: [prefix + 'a'] })
  child.emit('message', { id: 2, method: 'echo', args: [prefix + 'b'] })
  await settle()

  t.deepEqual(replies, [
    { id: 1, value: 'a' },
    { id: 2, value: 'b' }
  ])
})

test('the same arguments under different methods are told apart', async t => {
  const { child, replies } = fakeChild()
  attach(child, { one: () => 1, two: () => 2 })

  child.emit('message', { id: 1, method: 'one', args: [] })
  child.emit('message', { id: 2, method: 'two', args: [] })
  await settle()

  t.deepEqual(replies, [
    { id: 1, value: 1 },
    { id: 2, value: 2 }
  ])
})
