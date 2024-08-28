/* eslint-disable */

'use strict'

const test = require('ava')

const runSandbox = require('../src')

test('throw an error if snippet is not a function', t => {
  t.throws(
    () => {
      runSandbox('2+2')
    },
    { message: 'Expected a function' }
  )
})

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
      while (true) {
        i += 1 // eslint-disable
      }
    },
    { timeout: 100 }
  )

  await t.throwsAsync(fn(), { message: 'timeout: 100ms' })
})

test("don't expose internals", async t => {
  const fn = runSandbox(() => [
    !!_dispatch,
    !!base64ToBuffer,
    !!bufferToBase64,
    !!define,
    !!defineAsync,
    !!dispatch,
    !!httpRequest,
    !!info,
    !!setResult,
    !!globalThis._dispatch,
    !!globalThis.base64ToBuffer,
    !!globalThis.bufferToBase64,
    !!globalThis.define,
    !!globalThis.defineAsync,
    !!globalThis.dispatch,
    !!globalThis.httpRequest,
    !!globalThis.info,
    !!globalThis.setResult,
    !!globalThis._dispatch,
    !!globalThis.global.base64ToBuffer,
    !!globalThis.global.bufferToBase64,
    !!globalThis.global.define,
    !!globalThis.global.defineAsync,
    !!globalThis.global.dispatch,
    !!globalThis.global.httpRequest,
    !!globalThis.global.info,
    !!globalThis.global.setResult,
    !!global.base64ToBuffer,
    !!global.bufferToBase64,
    !!global.define,
    !!global.defineAsync,
    !!global.dispatch,
    !!global.httpRequest,
    !!global.info,
    !!global.setResult,
    !!global.globalThis.base64ToBuffer,
    !!global.globalThis.bufferToBase64,
    !!global.globalThis.define,
    !!global.globalThis.defineAsync,
    !!global.globalThis.dispatch,
    !!global.globalThis.httpRequest,
    !!global.globalThis.info,
    !!global.globalThis.setResult
  ])
  const result = await fn()
  t.is(result.every(Boolean), false)
})
