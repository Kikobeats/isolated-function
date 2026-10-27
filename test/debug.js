'use strict'

const { default: test } = require('ava')
const $ = require('tinyspawn')
const path = require('node:path')

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
