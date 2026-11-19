'use strict'

const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const path = require('path')
const test = require('ava')

const isolatedFunction = require('..')()

const wrapper = t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'isolated-exec-path-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))
  const marker = path.join(dir, 'marker')
  const bin = path.join(dir, 'wrapper')
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexec node "$@"\n`)
  chmodSync(bin, 0o755)
  return { bin, args: () => readFileSync(marker, 'utf8').trim().split('\n') }
}

test('runs the code through execPath in place of node', async t => {
  const { bin, args } = wrapper(t)
  const { value } = await isolatedFunction((x, y) => x + y, { execPath: bin })(2, 3)
  t.is(value, 5)
  t.deepEqual(args(), ['-'])
})

test('execPath keeps the resource limits, which run before it', async t => {
  const { bin, args } = wrapper(t)
  const { value } = await isolatedFunction(() => 'limited', {
    execPath: bin,
    timeout: 10000,
    memory: 128
  })()
  t.is(value, 'limited')
  t.deepEqual(args(), ['-'])
  const error = await t.throwsAsync(
    isolatedFunction(() => new Promise(() => setInterval(() => {}, 1000)), {
      execPath: bin,
      timeout: 500
    })()
  )
  t.is(error.name, 'TimeoutError')
})

test('execPath keeps the host channel', async t => {
  const { bin } = wrapper(t)
  const { value } = await isolatedFunction(() => globalThis.__isolated_host('answer'), {
    execPath: bin,
    host: { answer: async () => 42 }
  })()
  t.is(value, 42)
})

test('an execPath with a space in it is one path, not a command line', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'isolated exec path '))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'as fn')
  writeFileSync(bin, '#!/bin/sh\nexec node "$@"\n')
  chmodSync(bin, 0o755)
  t.is((await isolatedFunction(() => 'direct', { execPath: bin })()).value, 'direct')
  t.is(
    (await isolatedFunction(() => 'limited', { execPath: bin, timeout: 10000 })()).value,
    'limited'
  )
})

test('execPath is a non-empty string', t => {
  for (const execPath of ['', 0, null, ['node']]) {
    t.throws(() => isolatedFunction(() => 1, { execPath }), {
      instanceOf: TypeError,
      message: 'Expected `execPath` to be a non-empty string'
    })
  }
})

test('a missing execPath fails the run', async t => {
  const error = await t.throwsAsync(isolatedFunction(() => 1, { execPath: '/nonexistent/node' })())
  t.is(error.code, 'ENOENT')
})
