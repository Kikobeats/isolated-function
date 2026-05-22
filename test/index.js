'use strict'

const test = require('ava')

const isolatedFunction = require('..')()

const run = promise => Promise.resolve(promise).then(({ value }) => value)

test('runs plain javascript', async t => {
  t.is(await run(isolatedFunction(() => 2 + 2)()), 4)
  t.is(await run(isolatedFunction(String(() => 2 + 2))()), 4)
  t.is(await run(isolatedFunction('() => 2 + 2')()), 4)
  t.is(await run(isolatedFunction((x, y) => x + y)(2, 2)), 4)
  t.is(await run(isolatedFunction(() => 2 + 2)()), 4)
  t.is(
    await run(
      isolatedFunction(function () {
        return 2 + 2
      })()
    ),
    4
  )
})

test('capture logs', async t => {
  const fn = isolatedFunction(() => {
    console.log('console.log', { foo: 'bar' })
    console.info('console.info')
    console.debug('console.debug')
    console.warn('console.warn')
    console.error('console.error')
    return 'done'
  })

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
  const fn = isolatedFunction(() => {
    process.stdout.write('disturbing')
    return 'done'
  })

  const { value, logging } = await fn()
  t.is(value, 'done')
  t.deepEqual(logging, {})
})

test('resolve require dependencies', async t => {
  const fn = isolatedFunction(emoji => {
    const isEmoji = require('is-standard-emoji@1.0.0')
    return isEmoji(emoji)
  })

  t.is(await run(fn('🙌')), true)
  t.is(await run(fn('foo')), false)
})

test('install dependencies not directly in nodePaths', async t => {
  const path = require('path')
  const { mkdirSync, writeFileSync, rmSync } = require('fs')

  // Simulate production: a nodePaths dir deep in node_modules
  // with a dependency (cheerio) only in a *parent* node_modules
  const testDir = path.join(require('os').tmpdir(), `isolated-fn-nodepaths-${Date.now()}`)
  const nodePathDir = path.join(testDir, 'deep', 'nested', 'node_modules')
  mkdirSync(nodePathDir, { recursive: true })

  // Place a fake package in a parent directory's node_modules.
  // require.resolve({ paths }) would find it via traversal,
  // but esbuild's nodePaths does not traverse parents.
  const parentPkgDir = path.join(testDir, 'node_modules', 'is-standard-emoji')
  mkdirSync(parentPkgDir, { recursive: true })
  writeFileSync(
    path.join(parentPkgDir, 'package.json'),
    '{"name":"is-standard-emoji","version":"1.0.0"}'
  )
  writeFileSync(path.join(parentPkgDir, 'index.js'), 'module.exports = () => false')

  const instance = require('..')({ nodePaths: [nodePathDir] })
  const fn = instance(emoji => {
    const isEmoji = require('is-standard-emoji@1.0.0')
    return isEmoji(emoji)
  })

  // If the bug is present, the dep would be skipped (found via parent traversal)
  // and esbuild would use the fake parent version returning false.
  // With the fix, the dep is installed fresh into tmpdir and works correctly.
  t.is(await run(fn('🙌')), true)

  rmSync(testDir, { recursive: true, force: true })
})

test('runs async code', async t => {
  const fn = isolatedFunction(async duration => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    await delay(duration)
    return 'done'
  })

  t.is(await run(fn(200)), 'done')
})

test('escape arguments', async t => {
  const fn = isolatedFunction((...args) => args.length)

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
  const fn = isolatedFunction(() => {
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

  const { value, profiling } = await fn()

  t.is(value, undefined)
  t.is(typeof profiling.cpu, 'number')
  t.is(typeof profiling.memory, 'number')
  t.is(typeof profiling.phases.install, 'number')
  t.is(typeof profiling.phases.build, 'number')
  t.is(typeof profiling.phases.spawn, 'number')
  t.is(typeof profiling.phases.run, 'number')
  t.is(typeof profiling.phases.total, 'number')
})
