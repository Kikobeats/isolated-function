'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

module.exports = code => {
  const ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' })

  let newCode = ''
  let lastIndex = 0

  // Helper function to process and transform nodes
  const processNode = node => {
    if (node.type === 'Literal' && node.value.includes('@')) {
      // Check if it's a scoped module
      if (node.value.startsWith('@')) {
        // Handle scoped packages
        const slashIndex = node.value.indexOf('/')
        if (slashIndex !== -1) {
          const atVersionIndex = node.value.indexOf('@', slashIndex)
          const moduleName =
            atVersionIndex !== -1 ? node.value.substring(0, atVersionIndex) : node.value
          // Append code before this node
          newCode += code.substring(lastIndex, node.start)
          // Append transformed dependency
          newCode += `'${moduleName}'`
        }
      } else {
        // Handle non-scoped packages
        const [moduleName] = node.value.split('@')
        // Append code before this node
        newCode += code.substring(lastIndex, node.start)
        // Append transformed dependency
        newCode += `'${moduleName}'`
      }
      // Update lastIndex to end of current node
      lastIndex = node.end
    }
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
