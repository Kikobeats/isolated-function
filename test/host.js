'use strict'

const { default: test } = require('ava')

const { UNKNOWN_METHOD, TOO_MANY_CALLS } = require('../src/host')
const isolatedFunction = require('..')()

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
