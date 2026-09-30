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
  t.true(profiling.phases.connect <= profiling.phases.run)
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

test('a program cannot overwrite the phases the runner owns', async t => {
  const { profiling } = await run(
    `async () => {
      globalThis.__isolated_phase('run', 999999)
      globalThis.__isolated_phase('total', 999999)
      return 1
    }`
  )
  t.true(profiling.phases.run < 999999)
  t.true(profiling.phases.total < 999999)
})
