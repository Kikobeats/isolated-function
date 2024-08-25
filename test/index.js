'use strict'

const test = require('ava')

const runSandbox = require('../src')

test('runs plain javascript', async t => {
  {
    const sum = runSandbox(() => 2 + 2)
    t.is(await sum(), 4)
  }

  {
    const sum = runSandbox((x, y) => x + y)
    t.is(await sum(2, 2), 4)
  }
  {
    const fn = runSandbox(() => 2 + 2)
    t.is(await fn(), 4)
  }

  {
    const fn = runSandbox(function () {
      return 2 + 2
    })
    t.is(await fn(), 4)
  }

  {
    const fn = runSandbox('2+2')
    t.is(await fn(), 4)
  }
})

test('resolve require dependencies', async t => {
  const fn = runSandbox(emoji => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(emoji)
  })

  t.is(await fn('🙌'), true)
  t.is(await fn('foo'), false)
})

test('runs async code', async t => {
  const fn = runSandbox(async duration => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    await delay(duration)
    return 'done'
  })

  t.is(await fn(100), 'done')
})

test('throw errors', async t => {
  const fn = runSandbox(() => {
    throw new TypeError('oops')
  })

  await t.throwsAsync(fn(), { message: 'oops' })
})

test('handle timeout', async t => {
  const fn = runSandbox(
    () => {
      let i = 0
      while (true) i += 1
    },
    { timeout: 100 }
  )

  await t.throwsAsync(fn(), { message: 'timeout: 100ms' })
})
