'use strict'

const { execSync } = require('child_process')
const esbuild = require('esbuild')
const fs = require('fs/promises')
const { tmpdir } = require('os')
const $ = require('tinyspawn')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const detectDependencies = require('./detect-dependencies')
const generateTemplate = require('../template')

const MINIFY = process.env.ISOLATED_FUNCTIONS_MINIFY !== 'false'

const packageManager = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return { init: 'pnpm init', install: 'pnpm install' }
  } catch {
    return { init: 'npm init --yes', install: 'npm install' }
  }
})()

const getTmp = async content => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })

  const filepath = path.join(cwd, 'index.js')
  await fs.writeFile(filepath, content)

  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { filepath, cwd, content, cleanup }
}

module.exports = async snippet => {
  const compiledTemplate = generateTemplate(snippet)
  const dependencies = detectDependencies(compiledTemplate)
  const tmp = await getTmp(transformDependencies(compiledTemplate))

  await $(packageManager.init, { cwd: tmp.cwd })
  await $(`${packageManager.install} ${dependencies.join(' ')}`, {
    cwd: tmp.cwd
  })

  const result = await esbuild.build({
    entryPoints: [tmp.filepath],
    bundle: true,
    minify: MINIFY,
    write: false,
    platform: 'node'
  })

  await tmp.cleanup()
  return getTmp(result.outputFiles[0].text)
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
