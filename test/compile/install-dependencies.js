'use strict'

const test = require('ava')

const { DependencyNameError, DependencyUnallowedError } = require('../../src/errors')
const isolatedFunction = require('../..')

const run = promise => Promise.resolve(promise).then(({ value }) => value)

test('allow.dependencies › allows trusted dependencies', async t => {
  const [fn, cleanup] = isolatedFunction(
    emoji => {
      const isEmoji = require('is-standard-emoji@1.0.0')
      return isEmoji(emoji)
    },
    { allow: { dependencies: ['is-standard-emoji'] } }
  )

  t.teardown(cleanup)

  t.is(await run(fn('🙌')), true)
  t.is(await run(fn('foo')), false)
})

test('allow.dependencies › blocks untrusted dependencies', async t => {
  const [fn] = isolatedFunction(
    emoji => {
      const isEmoji = require('is-standard-emoji@1.0.0')
      return isEmoji(emoji)
    },
    { allow: { dependencies: ['lodash', 'axios'] } }
  )

  const error = await t.throwsAsync(fn('🙌'))

  t.true(error instanceof DependencyUnallowedError)
  t.is(error.message, "Dependency 'is-standard-emoji' is not in the allowed list")
  t.is(error.dependency, 'is-standard-emoji')
})

test('allow.dependencies › allows scoped packages', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      const timeSpan = require('@kikobeats/time-span')
      return typeof timeSpan
    },
    { allow: { dependencies: ['@kikobeats/time-span'] } }
  )

  t.teardown(cleanup)

  t.is(await run(fn()), 'function')
})

test('allow.dependencies › blocks untrusted scoped packages', async t => {
  const [fn] = isolatedFunction(
    () => {
      const timeSpan = require('@kikobeats/time-span')
      return typeof timeSpan
    },
    { allow: { dependencies: ['lodash'] } }
  )

  const error = await t.throwsAsync(fn())

  t.true(error instanceof DependencyUnallowedError)
  t.is(error.message, "Dependency '@kikobeats/time-span' is not in the allowed list")
  t.is(error.dependency, '@kikobeats/time-span')
})

test('allow.dependencies › works without restriction when not provided', async t => {
  const [fn, cleanup] = isolatedFunction(emoji => {
    const isEmoji = require('is-standard-emoji@1.0.0')
    return isEmoji(emoji)
  })

  t.teardown(cleanup)

  t.is(await run(fn('🙌')), true)
})

test('allow.dependencies › handles multiple dependencies', async t => {
  {
    const [fn, cleanup] = isolatedFunction(
      () => {
        const isEmoji = require('is-standard-emoji@1.0.0')
        const isNumber = require('is-number')
        return isEmoji('🙌') && isNumber(42)
      },
      { allow: { dependencies: ['is-standard-emoji', 'is-number'] } }
    )

    t.teardown(cleanup)
    t.is(await run(fn()), true)
  }
  {
    const [fn] = isolatedFunction(
      () => {
        const isEmoji = require('is-standard-emoji@1.0.0')
        const isNumber = require('is-number')
        return isEmoji('🙌') && isNumber(42)
      },
      { allow: { dependencies: ['is-standard-emoji'] } }
    )

    const error = await t.throwsAsync(fn())
    t.true(error instanceof DependencyUnallowedError)
    t.is(error.dependency, 'is-number')
  }
})

test('allow.dependencies › blocks invalid package names with spaces', async t => {
  const [fn] = isolatedFunction(
    () => {
      const _ = require('lodash@latest express')
      return typeof _
    },
    { allow: { dependencies: ['lodash'] } }
  )

  const error = await t.throwsAsync(fn())

  t.true(error instanceof DependencyNameError)
  t.is(error.dependency, 'lodash@latest express')
  t.true(error.message.includes('not a valid npm package name'))
})

test('allow.dependencies › blocks invalid package names even without allow list', async t => {
  const [fn] = isolatedFunction(() => {
    const _ = require('lodash@latest express')
    return typeof _
  })

  const error = await t.throwsAsync(fn())

  t.true(error instanceof DependencyNameError)
  t.is(error.dependency, 'lodash@latest express')
})
