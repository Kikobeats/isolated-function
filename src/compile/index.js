'use strict'

const fs = require('fs/promises')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const installDependencies = require('./install-dependencies')
const detectDependencies = require('./detect-dependencies')
const { duration } = require('../debug')
const template = require('../template')
const build = require('./build')

const tmpdirDefault = async () => {
  const cwd = await fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { cwd, cleanup }
}

module.exports = async (snippet, tmpdir = tmpdirDefault) => {
  let content = template(snippet)
  const { cwd, cleanup } = await duration('tmpdir', tmpdir)

  const dependencies = detectDependencies(content)
  if (dependencies.length) {
    content = transformDependencies(content)
    await duration('npm:install', () => installDependencies({ dependencies, cwd }), {
      dependencies
    })
  }

  const result = await duration('esbuild', () => build({ content, cwd }))
  content = result.outputFiles[0].text
  const cleanupPromise = duration('tmpDir:cleanup', cleanup)

  return { content, cleanupPromise }
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
