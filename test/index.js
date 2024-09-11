'use strict'

const test = require('ava')

const isolatedFunction = require('..')

const run = promise => Promise.resolve(promise).then(({ value }) => value)

test('runs plain javascript', async t => {
  {
    const [sum, cleanup] = isolatedFunction(() => 2 + 2)
    t.teardown(cleanup)
    t.is(await run(sum()), 4)
  }
  {
    const [sum, cleanup] = isolatedFunction(String(() => 2 + 2))
    t.teardown(cleanup)
    t.is(await run(sum()), 4)
  }
  {
    const [sum, cleanup] = isolatedFunction('() => 2 + 2')
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

test('capture logs', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    console.log('console.log', { foo: 'bar' })
    console.info('console.info')
    console.debug('console.debug')
    console.warn('console.warn')
    console.error('console.error')
    return 'done'
  })

  t.teardown(cleanup)

  const { value, logging } = await fn()
  t.is(value, 'done')
  t.deepEqual(logging, {
    log: [
      [
        'console.log',
        {
          foo: 'bar'
        }
      ]
    ],
    info: [['console.info']],
    debug: [['console.debug']],
    warn: [['console.warn']],
    error: [['console.error']]
  })
})

test('prevent to write to process.stdout', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    process.stdout.write('disturbing')
    return 'done'
  })

  t.teardown(cleanup)

  const { value, logging } = await fn()
  t.is(value, 'done')
  t.deepEqual(logging, {})
})

test('resolve require dependencies', async t => {
  const [fn, cleanup] = isolatedFunction(emoji => {
    const isEmoji = require('is-standard-emoji@1.0.0')
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

test('escape arguments', async t => {
  const [fn, cleanup] = isolatedFunction((...args) => args.length)
  t.teardown(cleanup)

  const result = await run(
    fn({
      device: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.89 Safari/537.36',
        viewport: {
          width: 1280,
          height: 800,
          deviceScaleFactor: 2,
          isMobile: false,
          hasTouch: false,
          isLandscape: false
        }
      }
    })
  )

  t.is(result, 1)
})

test('memory profiling', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    const storage = []
    const oneMegabyte = 1024 * 1024
    while (storage.length < 78) {
      const array = new Uint8Array(oneMegabyte)
      for (let i = 0; i < oneMegabyte; i += 4096) {
        array[i] = 1 // we have to put something in the array to flush to real memory
      }
      storage.push(array)
    }
  })
  t.teardown(cleanup)

  const { value, profiling } = await fn()

  t.is(value, undefined)
  t.is(typeof profiling.memory, 'number')
  t.is(typeof profiling.duration, 'number')
})
