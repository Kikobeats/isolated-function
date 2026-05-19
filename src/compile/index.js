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

const installQueues = new Map()

const enqueueInstall = (tmpdir, dependencies, allow) => {
  const pending = installQueues.get(tmpdir) || Promise.resolve()
  const next = pending.then(() => installDependencies({ dependencies, cwd: tmpdir, allow }))
  installQueues.set(
    tmpdir,
    next.catch(() => {})
  )
  return next
}

module.exports = async (snippet, { tmpdir = DEFAULT_TMPDIR, allow = {} } = {}) => {
  let content = template(snippet)
  let installMs = 0

  const dependencies = detectDependencies(content)
  if (dependencies.length) {
    content = transformDependencies(content)
    mkdirSync(tmpdir, { recursive: true })
    const installStart = Date.now()
    await duration('npm:install', () => enqueueInstall(tmpdir, dependencies, allow), {
      dependencies
    })
    installMs = Date.now() - installStart
  }

  const cwd = dependencies.length ? tmpdir : process.cwd()
  const buildStart = Date.now()
  const result = await duration('esbuild', () => build({ content, cwd }))
  const buildMs = Date.now() - buildStart
  debug('esbuild:output', { content: result.outputFiles[0].text.length })
  content = result.outputFiles[0].text

  return { content, install: installMs, build: buildMs }
}

module.exports.DEFAULT_TMPDIR = DEFAULT_TMPDIR
module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
