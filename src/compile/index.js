'use strict'

const { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } = require('fs')
const path = require('path')

const transformDependencies = require('./transform-dependencies')
const installDependencies = require('./install-dependencies')
const detectDependencies = require('./detect-dependencies')
const timeSpan = require('@kikobeats/time-span')()
const template = require('../template')
const build = require('./build')

const DEFAULT_TMPDIR = path.join(require('os').tmpdir(), 'isolated-fn-deps')

const installQueues = new Map()

const linkOne = (source, dest) => {
  try {
    symlinkSync(source, dest)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

const publishTree = (tree, tmpdir) => {
  if (tree === tmpdir) return
  const destRoot = path.join(tmpdir, 'node_modules')
  try {
    if (lstatSync(destRoot).isSymbolicLink()) rmSync(destRoot)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  mkdirSync(destRoot, { recursive: true })
  const sourceRoot = path.join(tree, 'node_modules')
  for (const name of readdirSync(sourceRoot)) {
    if (name.startsWith('.')) continue
    const source = path.join(sourceRoot, name)
    if (name.startsWith('@')) {
      const scopeDest = path.join(destRoot, name)
      mkdirSync(scopeDest, { recursive: true })
      for (const child of readdirSync(source)) {
        linkOne(path.join(source, child), path.join(scopeDest, child))
      }
      continue
    }
    linkOne(source, path.join(destRoot, name))
  }
}

const enqueueInstall = (tmpdir, dependencies, allow) => {
  const pending = installQueues.get(tmpdir) || Promise.resolve()
  const next = pending.then(() => installDependencies({ dependencies, cwd: tmpdir, allow }))
  installQueues.set(
    tmpdir,
    next.catch(() => {})
  )
  return next
}

module.exports = async (
  snippet,
  { tmpdir = DEFAULT_TMPDIR, allow = {}, nodePaths = [], esbuild, hostMethods } = {}
) => {
  let content = template(snippet, { hostMethods })
  const phases = { install: 0 }

  const allDependencies = detectDependencies(content)
  installDependencies.validateDependencies(allDependencies, allow.dependencies)
  const plan = installDependencies.planDependencies(allDependencies)
  const dependencies = nodePaths.length
    ? allDependencies.filter(dep => {
      const name = installDependencies.extractPackageName(dep)
      if (plan.requireAs.get(dep) !== name) return true
      const version = dep.slice(name.length + 1)
      for (const np of nodePaths) {
        try {
          const pkg = JSON.parse(readFileSync(path.join(np, name, 'package.json'), 'utf8'))
          if (version === 'latest') return false
          return pkg.version !== version
        } catch {}
      }
      return true
    })
    : allDependencies

  if (allDependencies.length) {
    content = transformDependencies(content, plan.requireAs)
    mkdirSync(tmpdir, { recursive: true })
  }

  let cwd = allDependencies.length ? tmpdir : process.cwd()

  if (dependencies.length) {
    const elapsed = timeSpan()
    const { install } = installDependencies.planDependencies(dependencies)
    const dir = installDependencies.treeDir(install)
    mkdirSync(dir, { recursive: true })
    if (!(await installDependencies.treeMatches(dir, install))) {
      await enqueueInstall(dir, dependencies, allow)
    }
    phases.install = elapsed()
    cwd = dir
    publishTree(dir, tmpdir)
  }
  const alias = { ...installDependencies.bundleAliases(cwd, plan.requireAs), ...esbuild?.alias }
  const elapsed = timeSpan()
  const result = await build({
    content,
    cwd,
    nodePaths,
    esbuild: Object.keys(alias).length ? { ...esbuild, alias } : esbuild
  })
  phases.build = elapsed()
  content = result.outputFiles[0].text

  return { content, phases }
}

module.exports.DEFAULT_TMPDIR = DEFAULT_TMPDIR
module.exports.detectDependencies = detectDependencies
module.exports.transformDependencies = transformDependencies
