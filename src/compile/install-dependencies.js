'use strict'

const { writeFileSync } = require('fs')
const { add } = require('upm')
const path = require('path')

const { DependencyNameError, DependencyUnallowedError } = require('../errors')

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

const uniqueByName = dependencies => {
  const byName = new Map()
  for (const dependency of dependencies) {
    const name = extractPackageName(dependency)
    const current = byName.get(name)
    if (current === undefined || current === `${name}@latest`) byName.set(name, dependency)
  }
  return [...byName.values()]
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
  ensurePackageJson(cwd)
  return add(uniqueByName(dependencies), { dir: cwd, minReleaseAge: 0 })
}

module.exports.validateDependencies = validateDependencies
module.exports.extractPackageName = extractPackageName
