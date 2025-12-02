'use strict'

const fs = require('fs/promises')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const installDependencies = require('./install-dependencies')
const detectDependencies = require('./detect-dependencies')
const { debug, duration } = require('../debug')
const template = require('../template')
const build = require('./build')

const tmpdirDefault = async () => {
  const duration = debug.duration()
  const cwd = await fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  duration('tmpdir', { cwd })
  return { cwd, cleanup }
}

module.exports = async (snippet, tmpdir = tmpdirDefault) => {
  let content = template(snippet)
  const { cwd, cleanup } = await tmpdir()

  const dependencies = detectDependencies(content)
  if (dependencies.length) {
    content = transformDependencies(content)
    await duration('npm:install', () => installDependencies({ dependencies, cwd }), {
      dependencies
    })
  }

  const result = await duration('esbuild', () => build({ content, cwd }))
  debug('esbuild:output', { content: result.outputFiles[0].text.length })
  content = result.outputFiles[0].text
  const cleanupPromise = duration('tmpDir:cleanup', cleanup)

  return { content, cleanupPromise }
}

module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
