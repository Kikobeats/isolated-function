'use strict'

const { execSync } = require('child_process')
const esbuild = require('esbuild')
const fs = require('fs/promises')
const $ = require('tinyspawn')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const detectDependencies = require('./detect-dependencies')
const generateTemplate = require('../template')
const measure = require('../measure')

const MINIFY = (() => {
  return process.env.ISOLATED_FUNCTIONS_MINIFY !== 'false'
    ? {}
    : {
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: true
      }
})()

const packageManager = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return { init: 'pnpm init', install: 'pnpm install' }
  } catch {
    return { init: 'npm init --yes', install: 'npm install' }
  }
})()

const tmpdirDefault = () => fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))

const getTmpDir = async tmpdir => {
  const cwd = await tmpdir()
  await fs.mkdir(cwd, { recursive: true })
  // TODO: fs.rm is not consistent over time
  // TODO: is recursive / force necessary?
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { cwd, cleanup }
}

module.exports = async (snippet, tmpdir = tmpdirDefault) => {
  const compiledTemplate = generateTemplate(snippet)
  const dependencies = detectDependencies(compiledTemplate)

  const content = transformDependencies(compiledTemplate)
  const tmpDir = await measure('getTmpDir', () => getTmpDir(tmpdir))

  await measure('npm:init', () => $(packageManager.init, { cwd: tmpDir.cwd }))
  await measure('npm:install', () =>
    $(`${packageManager.install} ${dependencies.join(' ')}`, { cwd: tmpDir.cwd })
  )

  const result = await measure('esbuild', () =>
    esbuild.build({
      stdin: {
        contents: content,
        resolveDir: tmpDir.cwd,
        sourcefile: 'index.js'
      },
      bundle: true,
      ...MINIFY,
      write: false,
      platform: 'node'
    })
  )

  return {
    content: result.outputFiles[0].text,
    cleanupPromise: measure('tmpDir:cleanup', () => tmpDir.cleanup())
  }
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
