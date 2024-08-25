'use strict'

const test = require('ava')

const createFunction = require('../src')

test('runs plain javascript', async t => {
  {
    const sum = createFunction(() => 2 + 2)
    t.is(await sum(), 4)
  }

  {
    const sum = createFunction((x, y) => x + y)
    t.is(await sum(2, 2), 4)
  }
  {
    const fn = createFunction(() => 2 + 2)
    t.is(await fn(), 4)
  }

  {
    const fn = createFunction(function () {
      return 2 + 2
    })
    t.is(await fn(), 4)
  }

  {
    const fn = createFunction('2+2')
    t.is(await fn(), 4)
  }
})

test('resolve require dependencies', async t => {
  const fn = createFunction(emoji => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(emoji)
  })

  t.is(await fn('🙌'), true)
  t.is(await fn('foo'), false)
})

test('runs async code', async t => {
  const fn = createFunction(async duration => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    await delay(duration)
    return 'done'
  })

  t.is(await fn(100), 'done')
})

test('throw errors', async t => {
  const fn = createFunction(() => {
    throw new TypeError('oops')
  })

  await t.throwsAsync(fn(), { message: 'oops' })
})
