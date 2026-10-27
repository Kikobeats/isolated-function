'use strict'

const { default: test } = require('ava')
const $ = require('tinyspawn')
const path = require('node:path')

const { flatten } = require('../src/debug')

test('nested fields become dotted keys', t => {
  t.deepEqual(flatten({ cpu: 12, memory: { used: 1024, heap: 512 }, phases: { run: 3 } }), {
    cpu: 12,
    'memory.used': 1024,
    'memory.heap': 512,
    'phases.run': 3
  })
})

test('null and scalar fields are kept as they are', t => {
  t.deepEqual(flatten({ size: 0, label: 'node', missing: null }), {
    size: 0,
    label: 'node',
    missing: null
  })
})

test('the node log line prints memory and phases as numbers', async t => {
  const script = `require(${JSON.stringify(
    path.join(__dirname, '..')
  )})()(() => 1, { timeout: 20000 })()`
  const { stderr } = await $('node', ['-e', script], {
    env: { ...process.env, DEBUG: 'isolated-function', DEBUG_COLORS: 'false' }
  })
  const line = stderr.split('\n').find(line => line.startsWith('isolated-function node '))
  t.truthy(line, stderr)
  t.false(line.includes('[object Object]'), line)
  for (const key of [
    'memory.total',
    'memory.used',
    'memory.heap',
    'memory.external',
    'phases.total'
  ]) {
    t.regex(line, new RegExp(` ${key.replace('.', '\\.')}=\\d+( |$)`), line)
  }
})
