'use strict'

const test = require('ava')

const build = require('../../src/compile/build')

test('forwards esbuild options', async t => {
  const { outputFiles } = await build({
    content: 'module.exports = () => process.env.FOO',
    cwd: __dirname,
    esbuild: { define: { 'process.env.FOO': '"bar"' } }
  })
  t.true(outputFiles[0].text.includes('"bar"'))
  t.false(outputFiles[0].text.includes('process.env.FOO'))
})
