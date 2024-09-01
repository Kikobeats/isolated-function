/* eslint-disable */

const test = require('ava')

const isolatedFunction = require('..')

test('throw an error if snippet is not a function', t => {
  t.throws(
    () => {
      isolatedFunction('2+2')
    },
    { message: 'Expected a function' }
  )
})

test('throw code errors', async t => {
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
        i += 1
      }
    },
    { timeout: 100 }
  )
  t.teardown(cleanup)

  const error = await t.throwsAsync(fn())

  t.is(error.message, 'Execution timed out')
  t.is(typeof error.profiling.duration, 'number')
})

test('handle OOM', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      const storage = []
      const twoMegabytes = 1024 * 1024 * 2
      while (true) {
        const array = new Uint8Array(twoMegabytes)
        for (let ii = 0; ii < twoMegabytes; ii += 4096) {
          array[ii] = 1 // we have to put something in the array to flush to real memory
        }
        storage.push(array)
      }
    },
    { memory: 1 }
  )
  t.teardown(cleanup)

  const error = await t.throwsAsync(fn())

  t.is(error.message, 'Out of memory')
  t.is(typeof error.profiling.duration, 'number')
})
