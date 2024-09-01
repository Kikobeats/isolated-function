'use strict'

const test = require('ava')

const isolatedFunction = require('..')

const run = promise => Promise.resolve(promise).then(([value]) => value)

test('runs plain javascript', async t => {
  {
    const [sum, cleanup] = isolatedFunction(() => 2 + 2)
    t.teardown(cleanup)
    t.is(await run(sum()), 4)
  }
  {
    const [sum, cleanup] = isolatedFunction((x, y) => x + y)
    t.teardown(cleanup)
    t.is(await run(sum(2, 2)), 4)
  }
  {
    const [fn, cleanup] = isolatedFunction(() => 2 + 2)
    t.teardown(cleanup)
    t.is(await run(fn()), 4)
  }
  {
    const [fn, cleanup] = isolatedFunction(function () {
      return 2 + 2
    })
    t.teardown(cleanup)
    t.is(await run(fn()), 4)
  }
})

test('resolve require dependencies', async t => {
  const [fn, cleanup] = isolatedFunction(emoji => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(emoji)
  })

  t.teardown(cleanup)

  t.is(await run(fn('🙌')), true)
  t.is(await run(fn('foo')), false)
})

test('runs async code', async t => {
  const [fn, cleanup] = isolatedFunction(async duration => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    await delay(duration)
    return 'done'
  })

  t.teardown(cleanup)
  t.is(await run(fn(200)), 'done')
})

test('memory profiling', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    const storage = []
    const twoMegabytes = 1024 * 1024 * 2
    while (storage.length < 200) {
      const array = new Uint8Array(twoMegabytes)
      for (let ii = 0; ii < twoMegabytes; ii += 4096) {
        array[ii] = 1 // we have to put something in the array to flush to real memory
      }
      storage.push(array)
    }
  })
  t.teardown(cleanup)

  const [value, profiling] = await fn()

  t.is(value, undefined)
  t.is(typeof profiling.memory, 'number')
  t.is(typeof profiling.duration, 'number')
})
