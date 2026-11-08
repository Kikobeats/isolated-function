'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const parseSpecifier = require('./parse-specifier')

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
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })

  let newCode = ''
  let lastIndex = 0

  const moduleName = value => {
    if (typeof value !== 'string') return
    const { name, version, subpath } = parseSpecifier(value)
    if (version === undefined) return
    return `${requireAs.get(`${name}@${version}`) ?? name}${subpath}`
  }

  const processNode = node => {
    if (node.type !== 'Literal') return
    const name = moduleName(node.value)
    if (!name || name === node.value) return
    newCode += code.substring(lastIndex, node.start)
    newCode += `'${name}'`
    lastIndex = node.end
  }

  // Traverse the AST to find require and import declarations
  walk.simple(ast, {
    CallExpression (node) {
      if (node.callee.name === 'require' && node.arguments.length === 1) {
        processNode(node.arguments[0])
      }
    },
    ImportDeclaration (node) {
      processNode(node.source)
    }
  })

  // Append remaining code after last modified dependency
  newCode += code.substring(lastIndex)

  return newCode
}
