'use strict'

module.exports = dependency => {
  if (dependency.startsWith('@')) {
    // Handle scoped packages
    const slashIndex = dependency.indexOf('/')
    if (slashIndex !== -1) {
      const atVersionIndex = dependency.indexOf('@', slashIndex)
      if (atVersionIndex !== -1) {
        // Scoped package with version
        const packageName = dependency.substring(0, atVersionIndex)
        const version = dependency.substring(atVersionIndex + 1)
        return `${packageName}@${version}`
      } else {
        // Scoped package without explicit version
        return `${dependency}@latest`
      }
    }
  } else {
    // Non-scoped packages
    const atVersionIndex = dependency.indexOf('@')
    if (atVersionIndex !== -1) {
      // Non-scoped package with version
      const packageName = dependency.substring(0, atVersionIndex)
      const version = dependency.substring(atVersionIndex + 1)
      return `${packageName}@${version}`
    }
  }
  // Non-scoped package without explicit version
  return `${dependency}@latest`
}
