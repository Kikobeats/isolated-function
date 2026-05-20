'use strict'

const { mkdirSync, readFileSync } = require('fs')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const installDependencies = require('./install-dependencies')
const detectDependencies = require('./detect-dependencies')
const timeSpan = require('@kikobeats/time-span')()
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

module.exports = async (snippet, { tmpdir = DEFAULT_TMPDIR, allow = {}, nodePaths = [] } = {}) => {
  let content = template(snippet)
  const phases = { install: 0 }

  const allDependencies = detectDependencies(content)
  installDependencies.validateDependencies(allDependencies, allow.dependencies)
  const dependencies = nodePaths.length
    ? allDependencies.filter(dep => {
      const name = installDependencies.extractPackageName(dep)
      const version = dep.slice(name.length + 1)
      try {
        const pkgPath = require.resolve(path.join(name, 'package.json'), { paths: nodePaths })
        if (version === 'latest') return false
        return JSON.parse(readFileSync(pkgPath, 'utf8')).version !== version
      } catch {
        return true
      }
    })
    : allDependencies

  if (dependencies.length) {
    content = transformDependencies(content)
    mkdirSync(tmpdir, { recursive: true })
    const elapsed = timeSpan()
    await enqueueInstall(tmpdir, dependencies, allow)
    phases.install = elapsed()
  } else if (allDependencies.length) {
    content = transformDependencies(content)
    mkdirSync(tmpdir, { recursive: true })
  }

  const cwd = allDependencies.length ? tmpdir : process.cwd()
  const elapsed = timeSpan()
  const result = await build({ content, cwd, nodePaths })
  phases.build = elapsed()
  content = result.outputFiles[0].text

  return { content, phases }
}

module.exports.DEFAULT_TMPDIR = DEFAULT_TMPDIR
module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
