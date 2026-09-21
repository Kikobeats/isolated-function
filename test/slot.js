'use strict'

const test = require('ava')
const path = require('path')
const os = require('os')

const createIsolatedFunction = require('..')
const { createShells, keyOf, fill, UNSPLICEABLE } = require('../src/compile/shells')

const { SLOT } = createIsolatedFunction

const SHELL = `async (x) => {
  const fn = ${SLOT}
  return fn(x)
}`

// ava runs a file's tests concurrently: anything that installs into or removes
// a tmpdir gets its own, or `teardown` in one test deletes another's install.
const ownTmpdir = name => path.join(os.tmpdir(), `isolated-fn-slot-${name}-${process.pid}`)

const run = async (isolatedFunction, snippet, opts, ...args) => {
  const result = await isolatedFunction(snippet, { throwError: false, ...opts })(...args)
  return result
}

test('a filled slot returns the same value as building the code inline', async t => {
  const isolatedFunction = createIsolatedFunction()
  const code = 'x => x * 2'

  const inline = await run(isolatedFunction, fill(SHELL, code), {}, 21)
  const slotted = await run(isolatedFunction, SHELL, { slot: code }, 21)

  t.true(slotted.isFulfilled)
  t.is(slotted.value, inline.value)
  t.is(slotted.value, 42)
})

test('different slot code reuses one cached shell build', async t => {
  const isolatedFunction = createIsolatedFunction()

  const first = await run(isolatedFunction, SHELL, { slot: 'x => x + 1' }, 1)
  const second = await run(isolatedFunction, SHELL, { slot: 'x => x + 2' }, 1)
  const third = await run(isolatedFunction, SHELL, { slot: "x => x + '!'" }, 1)

  t.is(first.value, 2)
  t.is(second.value, 3)
  t.is(third.value, '1!')
  t.is(isolatedFunction.shells.size, 1)
  t.is(second.profiling.phases.install, 0)
})

test('concurrent calls share a single shell build', async t => {
  const isolatedFunction = createIsolatedFunction()

  const results = await Promise.all(
    [1, 2, 3, 4].map(n => run(isolatedFunction, SHELL, { slot: `x => x * ${n}` }, 10))
  )

  t.deepEqual(
    results.map(({ value }) => value),
    [10, 20, 30, 40]
  )
  t.is(isolatedFunction.shells.size, 1)
})

test('replacement patterns in the slot code are inserted literally', async t => {
  const isolatedFunction = createIsolatedFunction()
  const { value } = await run(isolatedFunction, SHELL, { slot: "() => '$& $1 $$ $`'" })
  t.is(value, '$& $1 $$ $`')
})

test('an anonymous function expression is valid slot code', async t => {
  const isolatedFunction = createIsolatedFunction()
  const { value } = await run(isolatedFunction, SHELL, { slot: 'function (x) { return x - 1 }' }, 5)
  t.is(value, 4)
})

test('builtin modules stay on the cached path', async t => {
  const isolatedFunction = createIsolatedFunction()
  const { value } = await run(isolatedFunction, SHELL, {
    slot: "() => require('path').posix.join('a', 'b')"
  })
  t.is(value, 'a/b')
  t.is(isolatedFunction.shells.size, 1)
})

test('slot code with npm dependencies falls back to a full build', async t => {
  const isolatedFunction = createIsolatedFunction({ tmpdir: ownTmpdir('deps') })
  t.teardown(() => isolatedFunction.teardown())
  const { value, isFulfilled } = await run(
    isolatedFunction,
    SHELL,
    { slot: "x => require('is-number@7.0.0')(x)" },
    5
  )
  t.true(isFulfilled)
  t.true(value)
  t.is(isolatedFunction.shells.size, 0)
})

test('a syntax error in the slot code rejects as a SyntaxError', async t => {
  const isolatedFunction = createIsolatedFunction()
  const error = await t.throwsAsync(isolatedFunction(SHELL, { slot: 'x => {' })())
  t.is(error.name, 'SyntaxError')
})

test('esbuild options that cannot be keyed are never cached', async t => {
  const isolatedFunction = createIsolatedFunction()
  const plugin = { name: 'noop', setup () {} }
  const { value } = await run(
    isolatedFunction,
    SHELL,
    { slot: 'x => x', esbuild: { plugins: [plugin] } },
    7
  )
  t.is(value, 7)
  t.is(isolatedFunction.shells.size, 0)
})

test('the slot must be a string and the snippet must hold SLOT exactly once', t => {
  const isolatedFunction = createIsolatedFunction()
  t.throws(() => isolatedFunction(SHELL, { slot: () => 1 }), { instanceOf: TypeError })
  t.throws(() => isolatedFunction('x => x', { slot: 'x => x' }), { instanceOf: TypeError })
  t.throws(() => isolatedFunction(`${SLOT}; ${SLOT}`, { slot: 'x => x' }), {
    instanceOf: TypeError
  })
  t.throws(() => isolatedFunction(x => x, { slot: 'x => x' }), { instanceOf: TypeError })
})

test('teardown clears the shell cache', async t => {
  const isolatedFunction = createIsolatedFunction({ tmpdir: ownTmpdir('teardown') })
  await run(isolatedFunction, SHELL, { slot: 'x => x' }, 1)
  t.is(isolatedFunction.shells.size, 1)
  await isolatedFunction.teardown()
  t.is(isolatedFunction.shells.size, 0)
})

test('shells: a build without exactly one SLOT is marked unspliceable and holds no bytes', async t => {
  const shells = createShells()
  const value = await shells.get('twice', async () => ({ content: `${SLOT}${SLOT}` }))
  t.is(value, UNSPLICEABLE)
  t.is(shells.bytes, 0)
})

test('shells: the least recently used shell is evicted to stay within the byte budget', async t => {
  const shells = createShells({ maxBytes: 250 })
  const content = size => async () => ({ content: SLOT + 'x'.repeat(size - SLOT.length) })

  await shells.get('a', content(100))
  await shells.get('b', content(100))
  await shells.get('a', content(100))
  await shells.get('c', content(100))

  t.is(shells.size, 2)
  t.true(shells.bytes <= 250)

  let rebuilt = 0
  await shells.get('b', async () => {
    rebuilt++
    return { content: SLOT }
  })
  t.is(rebuilt, 1, '`b` was least recently used, so it was the one evicted')
})

test('shells: a shell larger than the whole budget is not kept', async t => {
  const shells = createShells({ maxBytes: 10 })
  await shells.get('big', async () => ({ content: SLOT + 'x'.repeat(100) }))
  t.is(shells.size, 0)
  t.is(shells.bytes, 0)
})

test('shells: a failed build is not cached, so the next call retries', async t => {
  const shells = createShells()
  await t.throwsAsync(
    shells.get('k', async () => {
      throw new Error('boom')
    })
  )
  t.is(shells.size, 0)
  t.is(await shells.get('k', async () => ({ content: SLOT })), SLOT)
})

test('keyOf: same inputs give the same key regardless of option key order', t => {
  const a = keyOf('s', {
    tmpdir: '/t',
    nodePaths: ['/n'],
    esbuild: { define: { a: '1' }, target: 'node24' }
  })
  const b = keyOf('s', {
    nodePaths: ['/n'],
    esbuild: { target: 'node24', define: { a: '1' } },
    tmpdir: '/t'
  })
  t.is(a, b)
  t.not(
    a,
    keyOf('s2', {
      tmpdir: '/t',
      nodePaths: ['/n'],
      esbuild: { define: { a: '1' }, target: 'node24' }
    })
  )
  t.not(
    a,
    keyOf('s', {
      tmpdir: '/other',
      nodePaths: ['/n'],
      esbuild: { define: { a: '1' }, target: 'node24' }
    })
  )
})
