'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const staticString = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
}

const propertyName = node => {
  if (node?.type !== 'MemberExpression') return
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed) return staticString(node.property)
}

const calleeSpecifier = node => {
  const callee = node.callee
  if (callee.type === 'Identifier' && callee.name === 'require' && node.arguments.length === 1) {
    return node.arguments[0]
  }
  const object = callee.type === 'MemberExpression' ? callee.object : undefined
  const name = propertyName(callee)
  if (object?.type !== 'Identifier' || node.arguments.length < 1) return
  if (
    (object.name === 'require' && name === 'resolve') ||
    (object.name === 'module' && name === 'require')
  ) {
    return node.arguments[0]
  }
}

module.exports = (code, onSpecifier) => {
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })
  const visit = node => {
    const specifier = staticString(node)
    if (typeof specifier === 'string') onSpecifier(specifier, node)
  }
  const visitSource = node => visit(node.source)

  walk.simple(ast, {
    CallExpression (node) {
      const specifier = calleeSpecifier(node)
      if (specifier) visit(specifier)
    },
    ImportExpression: visitSource,
    ImportDeclaration: visitSource,
    ExportAllDeclaration: visitSource,
    ExportNamedDeclaration (node) {
      if (node.source) visitSource(node)
    }
  })
}
