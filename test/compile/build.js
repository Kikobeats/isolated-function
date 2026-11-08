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

const fs = require('fs')
const os = require('os')
const path = require('path')

const hostFile = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-function-host-'))
  const file = path.join(dir, 'secret.json')
  fs.writeFileSync(file, '{"secret":"host"}')
  return file
}

for (const [label, specifier] of [
  ['a folded concatenation', file => `'${file.slice(0, 5)}' + '${file.slice(5)}'`],
  ['a conditional', file => `true ? '${file}' : 'x'`],
  ['a folded template literal', file => `\`${file.slice(0, 5)}\${'${file.slice(5)}'}\``]
]) {
  for (const call of ['require', 'import', 'require.resolve', 'module.require']) {
    test(`a ${call} of ${label} is not resolved`, async t => {
      const file = hostFile()
      const error = await t.throwsAsync(
        build({ content: `module.exports = () => ${call}(${specifier(file)})`, cwd: __dirname })
      )
      t.true(error.message.startsWith('Build failed'))
      t.true(error.message.includes('string literal'))
    })
  }
}

test('a string literal and its package internals are resolved', async t => {
  const { outputFiles } = await build({
    content: "module.exports = () => typeof require('acorn-walk').simple",
    cwd: path.join(__dirname, '../..')
  })
  t.true(outputFiles[0].text.includes('simple'))
})

test('runs the caller plugins and inject files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-function-inject-'))
  const inject = path.join(dir, 'inject.js')
  fs.writeFileSync(inject, "export const injected = require('path').sep")
  const resolved = []
  const { outputFiles } = await build({
    content: "module.exports = () => [injected, require('node:os').EOL]",
    cwd: __dirname,
    esbuild: {
      inject: [inject],
      plugins: [
        {
          name: 'probe',
          setup: build =>
            build.onResolve({ filter: /^node:os$/ }, args => {
              resolved.push(args.path)
            })
        }
      ]
    }
  })
  t.true(outputFiles[0].text.includes('injected'))
  t.deepEqual(resolved, ['node:os'])
})

test('a folded builtin is left to the runtime', async t => {
  const { outputFiles } = await build({
    content: "module.exports = () => [require('node:' + 'sqlite'), require('f' + 's')]",
    cwd: __dirname
  })
  t.true(outputFiles[0].text.includes('node:sqlite'))
})

test('a computed require from a relative directory is not bundled', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-function-rel-'))
  fs.writeFileSync(path.join(dir, 'secret.json'), '{"secret":"host"}')
  const error = await t.throwsAsync(
    build({
      content: "module.exports = () => require('.' + '/secret.json')",
      cwd: path.relative(process.cwd(), dir)
    })
  )
  t.true(error.message.includes('string literal'))
})

for (const call of [
  "module.require('acorn-walk').simple",
  "module['require']('acorn-walk').simple",
  "module[`require`]('acorn-walk').simple"
]) {
  test(`a string literal ${call} is bundled`, async t => {
    const { outputFiles } = await build({
      content: `module.exports = () => typeof ${call}`,
      cwd: path.join(__dirname, '../..')
    })
    t.true(outputFiles[0].text.includes('simple'))
  })
}

for (const call of [
  "require.resolve('acorn-walk')",
  "require['resolve']('acorn-walk')",
  "require[`resolve`]('acorn-walk')"
]) {
  test(`a string literal ${call} is left unresolved`, async t => {
    const { outputFiles } = await build({
      content: `module.exports = () => ${call}`,
      cwd: path.join(__dirname, '../..')
    })
    t.true(outputFiles[0].text.includes('acorn-walk'))
  })
}

test('a computed require.resolve does not read a host file', async t => {
  const file = hostFile()
  const error = await t.throwsAsync(
    build({
      content: `module.exports = () => require['res' + 'olve'](${JSON.stringify(file)})`,
      cwd: __dirname
    })
  )
  t.true(error.message.includes('string literal'))
})
