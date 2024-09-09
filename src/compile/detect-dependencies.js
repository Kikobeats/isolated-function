'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const parseDependency = require('./parse-dependency')

module.exports = code => {
  const dependencies = new Set()

  // Parse the code into an AST
  const ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' })

  // Traverse the AST to find require and import statements
  walk.simple(ast, {
    CallExpression (node) {
      if (
        node.callee.name === 'require' &&
        node.arguments.length === 1 &&
        node.arguments[0].type === 'Literal'
      ) {
        const dependency = node.arguments[0].value
        dependencies.add(parseDependency(dependency))
      }
    },
    ImportDeclaration (node) {
      const source = node.source.value
      dependencies.add(parseDependency(source))
    }
  })

  return Array.from(dependencies)
}

module.exports.parseDependency = parseDependency
