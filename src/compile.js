'use strict'

const walk = require('acorn-walk')
const esbuild = require('esbuild')
const fs = require('fs/promises')
const { tmpdir } = require('os')
const acorn = require('acorn')
const $ = require('tinyspawn')
const path = require('path')

const generateTemplate = require('./template')

// Function to detect require and import statements using acorn
const detectDependencies = code => {
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
        dependencies.add(node.arguments[0].value)
      }
    },
    ImportDeclaration (node) {
      dependencies.add(node.source.value)
    }
  })

  return Array.from(dependencies)
}

module.exports = async snippet => {
  const tmp = await fs.mkdtemp(path.join(tmpdir(), 'compile-'))
  await fs.mkdir(tmp, { recursive: true })

  const template = generateTemplate(snippet)

  const entryFile = path.join(tmp, 'index.js')
  await fs.writeFile(entryFile, template)

  const dependencies = detectDependencies(template)
  await $(`pnpm init && pnpm install ${dependencies.join(' ')}`, { cwd: tmp })

  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    write: false,
    platform: 'node'
  })

  const bundledCode = result.outputFiles[0].text

  await fs.rm(tmp, { recursive: true })

  return bundledCode
}

module.exports.detectDependencies = detectDependencies
