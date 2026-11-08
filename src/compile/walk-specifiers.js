'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const staticString = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
}

const isRequire = node => node.callee.name === 'require' && node.arguments.length === 1

module.exports = (code, onSpecifier) => {
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })
  const visit = node => {
    const specifier = staticString(node)
    if (specifier !== undefined) onSpecifier(specifier, node)
  }
  const visitSource = node => visit(node.source)

  walk.simple(ast, {
    CallExpression (node) {
      if (isRequire(node)) visit(node.arguments[0])
    },
    ImportExpression: visitSource,
    ImportDeclaration: visitSource,
    ExportAllDeclaration: visitSource,
    ExportNamedDeclaration (node) {
      if (node.source) visitSource(node)
    }
  })
}
