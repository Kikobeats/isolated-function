'use strict'

const parseSpecifier = require('./parse-specifier')
const walkSpecifiers = require('./walk-specifiers')

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
