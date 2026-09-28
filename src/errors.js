'use strict'

class IsolatedFunctionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'IsolatedFunctionError'
  }
}

class DependencyNameError extends IsolatedFunctionError {
  constructor (dependency) {
    super(`Dependency '${dependency}' is not a valid npm package name`)
    this.name = 'DependencyNameError'
    this.code = 'EDEPENDENCYNAME'
    this.dependency = dependency
  }
}

class DependencyUnallowedError extends IsolatedFunctionError {
  constructor (dependency) {
    super(`Dependency '${dependency}' is not in the allowed list`)
    this.name = 'DependencyUnallowedError'
    this.code = 'EDEPENDENCYUNALLOWED'
    this.dependency = dependency
  }
}

class DependencyConflictError extends IsolatedFunctionError {
  constructor (dependency, specs) {
    const listed = specs.map(spec => `'${spec}'`).join(' and ')
    super(`Dependency '${dependency}' is required as ${listed}`)
    this.name = 'DependencyConflictError'
    this.code = 'EDEPENDENCYCONFLICT'
    this.dependency = dependency
  }
}

module.exports = {
  IsolatedFunctionError,
  DependencyNameError,
  DependencyUnallowedError,
  DependencyConflictError
}
