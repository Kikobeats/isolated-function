'use strict'

const { default: test } = require('ava')

const isolatedFunction = require('..')()

const run = (snippet, opts = {}) => isolatedFunction(snippet, { timeout: 20000, ...opts })()

test('a program that records nothing reports the usual phases', async t => {
  const { profiling } = await run('() => 1')
  t.deepEqual(Object.keys(profiling.phases), ['install', 'build', 'spawn', 'run', 'total'])
})

test('a program can name a span of its own time', async t => {
  const { profiling } = await run(
    'async () => globalThis.__isolated_time("connect", () => new Promise(r => setTimeout(r, 120)))'
  )
  t.true(profiling.phases.connect >= 100)
  t.true(profiling.phases.connect <= profiling.phases.total)
})

test('a recorded span survives the value the program returns', async t => {
  const { value, profiling } = await run(
    'async () => globalThis.__isolated_time("connect", async () => "answer")'
  )
  t.is(value, 'answer')
  t.true(Number.isFinite(profiling.phases.connect))
})

test('a span is recorded even when the work inside it throws', async t => {
  const { profiling } = await run(
    `async () => {
      try {
        await globalThis.__isolated_time('connect', async () => { throw new Error('refused') })
      } catch {}
      return 1
    }`
  )
  t.true(Number.isFinite(profiling.phases.connect))
})

test('the same name accumulates rather than replacing', async t => {
  const { profiling } = await run(
    `async () => {
      globalThis.__isolated_phase('resolve', 10)
      globalThis.__isolated_phase('resolve', 15)
      return 1
    }`
  )
  t.is(profiling.phases.resolve, 25)
})

test('a program cannot overwrite any phase the runner owns', async t => {
  const OWNED = ['install', 'build', 'spawn', 'run', 'total']
  const claims = OWNED.map(name => `globalThis.__isolated_phase('${name}', 999999)`).join('\n')
  const { profiling } = await run(`async () => {\n${claims}\nreturn 1\n}`)

  for (const name of OWNED) {
    t.true(profiling.phases[name] < 999999, name)
  }
})

test('run reports what no span claimed', async t => {
  const { profiling } = await run(
    `async () => {
      await globalThis.__isolated_time('connect', () => new Promise(r => setTimeout(r, 200)))
      await new Promise(r => setTimeout(r, 60))
      return 1
    }`
  )
  const { connect, run: remainder } = profiling.phases

  t.true(connect >= 190)
  t.true(remainder >= 50 && remainder < 150, `remainder was ${remainder}`)
})

test('the phases never claim more than the total', async t => {
  const { profiling } = await run(
    "async () => globalThis.__isolated_time('connect', () => new Promise(r => setTimeout(r, 150)))"
  )
  const { install, build, spawn, connect, run: remainder, total } = profiling.phases
  const sum = install + build + spawn + connect + remainder

  // Time the host spends waiting, such as on a build another call is doing,
  // belongs to no phase, so the parts can add up to less than the whole.
  t.true(sum <= total + 5, `sum ${sum} vs total ${total}`)
  t.true(connect + remainder >= 140, 'the span and what is left of run cover the work')
})

test('a span inside another is not subtracted twice', async t => {
  const { profiling } = await run(
    `async () => globalThis.__isolated_time('outer', () =>
       globalThis.__isolated_time('inner', () => new Promise(r => setTimeout(r, 150))))`
  )
  const { outer, inner, run: remainder } = profiling.phases

  t.true(outer >= 140)
  t.true(inner >= 140)
  t.true(remainder < 100, `remainder was ${remainder}, inner should not be subtracted again`)
})

test('a duration the program asserts does not reduce run', async t => {
  const { profiling } = await run(
    `async () => {
      globalThis.__isolated_phase('claimed', 5000)
      await new Promise(r => setTimeout(r, 120))
      return 1
    }`
  )
  t.is(profiling.phases.claimed, 5000)
  t.true(profiling.phases.run >= 100, 'only a timed span owns elapsed time')
})

test('spawn is unaffected by what the program names', async t => {
  const plain = await run('async () => new Promise(r => setTimeout(r, 150))')
  const named = await run(
    "async () => globalThis.__isolated_time('connect', () => new Promise(r => setTimeout(r, 150)))"
  )

  t.true(Math.abs(plain.profiling.phases.spawn - named.profiling.phases.spawn) < 120)
})

test('overlapping spans account for the window they share', async t => {
  const { profiling } = await run(
    `async () => {
      const d = ms => new Promise(r => setTimeout(r, ms))
      await Promise.all([
        globalThis.__isolated_time('a', () => d(50)),
        globalThis.__isolated_time('b', () => d(200))
      ])
      return 1
    }`
  )
  const { a, b, run: remainder } = profiling.phases

  t.true(a >= 40 && a < 120, `a was ${a}`)
  t.true(b >= 180, `b was ${b}`)
  t.true(remainder < 100, `the longer span still covered the window, run was ${remainder}`)
})

test('the order two overlapping spans start in does not change run', async t => {
  const shape = first => `async () => {
    const d = ms => new Promise(r => setTimeout(r, ms))
    await Promise.all([
      globalThis.__isolated_time('${first}', () => d(${first === 'long' ? 200 : 50})),
      globalThis.__isolated_time('${first === 'long' ? 'short' : 'long'}', () => d(${
    first === 'long' ? 50 : 200
  }))
    ])
    return 1
  }`

  const longFirst = await run(shape('long'))
  const shortFirst = await run(shape('short'))

  t.true(longFirst.profiling.phases.run < 100)
  t.true(shortFirst.profiling.phases.run < 100)
})

test('a span named after a runner phase is ignored rather than hidden', async t => {
  const { profiling } = await run(
    `async () => {
      await globalThis.__isolated_time('run', () => new Promise(r => setTimeout(r, 150)))
      return 1
    }`
  )
  t.true(
    profiling.phases.run >= 140,
    `run was ${profiling.phases.run}, the span must not be subtracted`
  )
})

test('a span named after a runner phase still returns its value', async t => {
  const { value } = await run(
    "async () => globalThis.__isolated_time('total', async () => 'answer')"
  )
  t.is(value, 'answer')
})
