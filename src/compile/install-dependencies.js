'use strict'

const { globSync, readFileSync, realpathSync, writeFileSync } = require('fs')
const { add } = require('upm')
const path = require('path')

const {
  DependencyConflictError,
  DependencyNameError,
  DependencyUnallowedError
} = require('../errors')

const ensurePackageJson = cwd => {
  try {
    writeFileSync(path.join(cwd, 'package.json'), '{}\n', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

const extractPackageName = dependency => {
  if (dependency.startsWith('@')) {
    const slashIndex = dependency.indexOf('/')
    if (slashIndex !== -1) {
      const atVersionIndex = dependency.indexOf('@', slashIndex)
      if (atVersionIndex !== -1) {
        return dependency.substring(0, atVersionIndex)
      }
    }
  } else {
    const atVersionIndex = dependency.indexOf('@')
    if (atVersionIndex !== -1) {
      return dependency.substring(0, atVersionIndex)
    }
  }
  return dependency
}

const aliasName = (name, version) =>
  `${name}-${version.replace(/[^A-Za-z0-9._-]/g, char => `_${char.codePointAt(0).toString(16)}_`)}`

const planDependencies = dependencies => {
  const groups = new Map()
  for (const dependency of dependencies) {
    const name = extractPackageName(dependency)
    const specs = groups.get(name)
    if (specs) {
      if (!specs.includes(dependency)) specs.push(dependency)
    } else groups.set(name, [dependency])
  }

  const install = []
  const requireAs = new Map()

  for (const [name, specs] of groups) {
    const latest = `${name}@latest`
    const concrete = specs.filter(spec => spec !== latest)
    if (concrete.length > 1 && specs.includes(latest)) {
      throw new DependencyConflictError(name, [latest, ...concrete])
    }
    if (concrete.length <= 1) {
      install.push(concrete[0] || latest)
      for (const spec of specs) requireAs.set(spec, name)
      continue
    }
    for (const spec of concrete) {
      const version = spec.slice(name.length + 1)
      const alias = aliasName(name, version)
      install.push(`${alias}@npm:${name}@${version}`)
      requireAs.set(spec, alias)
    }
  }

  return { install, requireAs }
}

const samePackageDir = (dir, name) => dir.endsWith(`${path.sep}${name.split('/').join(path.sep)}`)

const installedPackages = cwd => {
  let files
  try {
    files = globSync('node_modules/.upm/**/package.json', { cwd })
  } catch {
    return []
  }
  const packages = []
  for (const rel of files) {
    const file = path.join(cwd, rel)
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      packages.push({ dir: realpathSync(path.dirname(file)), name: pkg.name, version: pkg.version })
    } catch {}
  }
  return packages
}

// esbuild dedupes modules that resolve to the same file. An npm alias is a second
// copy of a version another package may already depend on, so point the alias at that copy.
const bundleAliases = (cwd, requireAs) => {
  const aliased = [...requireAs].filter(([spec, mod]) => mod !== extractPackageName(spec))
  if (aliased.length === 0) return {}
  const packages = installedPackages(cwd)
  const alias = {}
  for (const [, mod] of aliased) {
    let own
    try {
      own = realpathSync(path.join(cwd, 'node_modules', mod))
    } catch {
      continue
    }
    const installed = packages.find(pkg => pkg.dir === own)
    if (!installed) continue
    const copies = packages.filter(
      pkg => pkg.dir !== own && pkg.name === installed.name && pkg.version === installed.version
    )
    const shared = copies.find(pkg => samePackageDir(pkg.dir, installed.name)) || copies[0]
    if (shared) alias[mod] = shared.dir
  }
  return alias
}

const validateDependencies = (dependencies, allowed) => {
  // Always check for command injection, regardless of allow list
  for (const dependency of dependencies) {
    if (dependency.includes(' ')) {
      throw new DependencyNameError(dependency)
    }
  }

  if (!allowed) return

  for (const dependency of dependencies) {
    const packageName = extractPackageName(dependency)
    if (!allowed.includes(packageName)) {
      throw new DependencyUnallowedError(packageName)
    }
  }
}

module.exports = async ({ dependencies, cwd, allow = {} }) => {
  validateDependencies(dependencies, allow.dependencies)
  const { install } = planDependencies(dependencies)
  ensurePackageJson(cwd)
  return add(install, { dir: cwd, minReleaseAge: 0 })
}

module.exports.validateDependencies = validateDependencies
module.exports.extractPackageName = extractPackageName
module.exports.planDependencies = planDependencies
module.exports.bundleAliases = bundleAliases
