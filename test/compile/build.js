'use strict'

const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const test = require('ava')

const build = require('../../src/compile/build')

test('replaces the vendored rxjs puppeteer bundles', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'rxjs-'))
  t.teardown(() => rmSync(cwd, { recursive: true, force: true }))
  mkdirSync(join(cwd, 'third_party', 'rxjs'), { recursive: true })
  writeFileSync(join(cwd, 'third_party', 'rxjs', 'rxjs.js'), 'module.exports = { timer: "full" }\n')

  const { outputFiles } = await build({
    content: "const rx = require('./third_party/rxjs/rxjs.js'); module.exports = typeof rx.timer",
    cwd
  })
  const text = outputFiles[0].text
  t.false(text.includes('"full"'))
  t.true(text.includes('function'))
  t.true(text.includes('Apache License'))
  t.true(text.length > 10_000)
})

test('forwards esbuild options', async t => {
  const { outputFiles } = await build({
    content: 'module.exports = () => process.env.FOO',
    cwd: __dirname,
    esbuild: { define: { 'process.env.FOO': '"bar"' } }
  })
  t.true(outputFiles[0].text.includes('"bar"'))
  t.false(outputFiles[0].text.includes('process.env.FOO'))
})
