'use strict'

const parseSpecifier = require('./parse-specifier')
const walkSpecifiers = require('./walk-specifiers')

/**
 * Transforms dependency module names by removing version specifiers.
 *
 * Parses JavaScript code and walks through the AST to find all require() calls
 * and import declarations. Extracts module names from strings that include
 * version information (e.g., 'is-emoji@1.0.0' becomes 'is-emoji').
 *
 * Handles both:
 * - Scoped packages: '@scope/package@1.0.0' → '@scope/package'
 * - Regular packages: 'package@1.0.0' → 'package'
 *
 * This transformation is necessary because the dependency strings include
 * version specifiers for installation tracking, but require/import statements
 * should only reference the base module name.
 *
 * @param {string} code - JavaScript code containing require() or import statements
 * @param {Map<string, string>} [requireAs] - Spec to module name. Two versions of one package map to npm alias names.
 * @returns {string} Transformed code with version specifiers removed from dependencies
 */
module.exports = (code, requireAs = new Map()) => {
  const moduleName = value => {
    const { name, version, subpath } = parseSpecifier(value)
    if (version === undefined) return
    return `${requireAs.get(`${name}@${version}`) ?? name}${subpath}`
  }

  const replacements = []
  walkSpecifiers(code, (specifier, node) => {
    const name = moduleName(specifier)
    if (name && (name !== specifier || node.type === 'TemplateLiteral')) {
      replacements.push({ start: node.start, end: node.end, name })
    }
  })

  let newCode = ''
  let lastIndex = 0
  for (const { start, end, name } of replacements.sort((a, b) => a.start - b.start)) {
    newCode += `${code.substring(lastIndex, start)}'${name}'`
    lastIndex = end
  }
  return newCode + code.substring(lastIndex)
}
