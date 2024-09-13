'use strict'

const { execSync } = require('child_process')
const esbuild = require('esbuild')
const fs = require('fs/promises')
const $ = require('tinyspawn')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const detectDependencies = require('./detect-dependencies')
const generateTemplate = require('../template')
const { duration } = require('../debug')

const MINIFY = (() => {
  return process.env.ISOLATED_FUNCTIONS_MINIFY !== 'false'
    ? {}
    : {
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: true
      }
})()

const install = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return 'pnpm install'
  } catch {
    return 'npm install'
  }
})()

const tmpdirDefault = async () => {
  const cwd = await fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { cwd, cleanup }
}

module.exports = async (snippet, tmpdir = tmpdirDefault) => {
  const compiledTemplate = generateTemplate(snippet)
  const dependencies = detectDependencies(compiledTemplate)

  const content = transformDependencies(compiledTemplate)
  const tmpDir = await duration('tmpdir', tmpdir)

  await duration('npm:init', () => fs.writeFile(path.join(tmpDir.cwd, 'package.json'), '{}'))
  await duration('npm:install', () =>
    $(`${install} ${dependencies.join(' ')}`, { cwd: tmpDir.cwd })
  )

  const result = await duration('esbuild', () =>
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
    cleanupPromise: duration('tmpDir:cleanup', tmpDir.cleanup)
  }
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
