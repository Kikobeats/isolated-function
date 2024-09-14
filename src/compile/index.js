'use strict'

const fs = require('fs/promises')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const detectDependencies = require('./detect-dependencies')
const installDependencies = require('./install-dependencies')
const generateTemplate = require('../template')
const { duration } = require('../debug')
const build = require('./build')

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
  await duration('npm:install', () => installDependencies({ dependencies, cwd: tmpDir.cwd }), {
    dependencies
  })
  const result = await duration('esbuild', () => build({ content, cwd: tmpDir.cwd }))

  return {
    content: result.outputFiles[0].text,
    cleanupPromise: duration('tmpDir:cleanup', tmpDir.cleanup)
  }
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
