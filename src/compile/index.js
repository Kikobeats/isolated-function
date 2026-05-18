'use strict'

const { mkdirSync } = require('fs')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const installDependencies = require('./install-dependencies')
const detectDependencies = require('./detect-dependencies')
const { debug, duration } = require('../debug')
const template = require('../template')
const build = require('./build')

const DEFAULT_TMPDIR = path.join(require('os').tmpdir(), 'isolated-fn-deps')

module.exports = async (snippet, { tmpdir = DEFAULT_TMPDIR, allow = {} } = {}) => {
  let content = template(snippet)

  const dependencies = detectDependencies(content)
  if (dependencies.length) {
    content = transformDependencies(content)
    mkdirSync(tmpdir, { recursive: true })
    await duration('npm:install', () => installDependencies({ dependencies, cwd: tmpdir, allow }), {
      dependencies
    })
  }

  const cwd = dependencies.length ? tmpdir : process.cwd()
  const result = await duration('esbuild', () => build({ content, cwd }))
  debug('esbuild:output', { content: result.outputFiles[0].text.length })
  content = result.outputFiles[0].text

  return content
}

module.exports.DEFAULT_TMPDIR = DEFAULT_TMPDIR
module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
