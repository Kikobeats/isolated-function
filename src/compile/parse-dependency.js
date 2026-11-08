'use strict'

const parseSpecifier = require('./parse-specifier')

module.exports = dependency => {
  const { name, version = 'latest' } = parseSpecifier(dependency)
  return `${name}@${version}`
}
