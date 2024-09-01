/* eslint-disable */

'use strict'

const test = require('ava')

const isolatedFunction = require('../src')

test('throw an error if snippet is not a function', t => {
  t.throws(
    () => {
      isolatedFunction('2+2')
    },
    { message: 'Expected a function' }
  )
})

test('runs plain javascript', async t => {
  {
    const [sum, cleanup] = isolatedFunction(() => 2 + 2)
    t.teardown(cleanup)
    t.is(await sum(), 4)
  }

  {
    const [sum, cleanup] = isolatedFunction((x, y) => x + y)
    t.teardown(cleanup)
    t.is(await sum(2, 2), 4)
  }
  {
    const [fn, cleanup] = isolatedFunction(() => 2 + 2)
    t.teardown(cleanup)
    t.is(await fn(), 4)
  }

  {
    const [fn, cleanup] = isolatedFunction(function () {
      return 2 + 2
    })
    t.teardown(cleanup)
    t.is(await fn(), 4)
  }
})

test('resolve require dependencies', async t => {
  const [fn, cleanup] = isolatedFunction(emoji => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(emoji)
  })

  t.teardown(cleanup)
  t.is(await fn('🙌'), true)
  t.is(await fn('foo'), false)
})

test('runs async code', async t => {
  const [fn, cleanup] = isolatedFunction(async duration => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    await delay(duration)
    return 'done'
  })

  t.teardown(cleanup)
  t.is(await fn(100), 'done')
})

test('throw errors', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    throw new TypeError('oops')
  })

  t.teardown(cleanup)
  await t.throwsAsync(fn(), { message: 'oops' })
})

test('handle timeout', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      let i = 0
      while (true) {
        i += 1 // eslint-disable
      }
    },
    { timeout: 100 }
  )
  t.teardown(cleanup)

  await t.throwsAsync(fn(), { message: 'Execution timed out' })
})
