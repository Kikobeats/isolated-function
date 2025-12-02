'use strict'

const { execSync } = require('child_process')
const $ = require('tinyspawn')

const install = (() => {
  try {
    execSync('which pnpm', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return 'pnpm install --no-lockfile --prefer-offline --ignore-workspace-root-check --ignore-scripts --engine-strict=false'
  } catch {
    return 'npm install --no-package-lock --ignore-scripts --silent'
  }
})()

class UntrustedDependencyError extends Error {
  constructor (dependency) {
    super(`Dependency '${dependency}' is not in the allowed list`)
    this.name = 'UntrustedDependencyError'
    this.dependency = dependency
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

const validateDependencies = (dependencies, allowed) => {
  if (!allowed) return

  for (const dependency of dependencies) {
    const packageName = extractPackageName(dependency)
    if (!allowed.includes(packageName)) {
      throw new UntrustedDependencyError(packageName)
    }
  }
}

module.exports = async ({ dependencies, cwd, allow = {} }) => {
  validateDependencies(dependencies, allow.dependencies)
  return $(`${install} ${dependencies.join(' ')}`, { cwd, env: { ...process.env, CI: true } })
}

module.exports.UntrustedDependencyError = UntrustedDependencyError
