'use strict'

const { execSync } = require('child_process')
const walk = require('acorn-walk')
const esbuild = require('esbuild')
const fs = require('fs/promises')
const { tmpdir } = require('os')
const acorn = require('acorn')
const $ = require('tinyspawn')
const path = require('path')

const generateTemplate = require('./template')

const MINIFY = process.env.ISOLATED_FUNCTIONS_MINIFY !== 'false'

const packageManager = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return { init: 'pnpm init', install: 'pnpm install' }
  } catch {
    return { init: 'npm init --yes', install: 'npm install' }
  }
})()

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

const getTmp = async content => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })

  const filepath = path.join(cwd, 'index.js')
  await fs.writeFile(filepath, content)

  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { filepath, cwd, content, cleanup }
}

module.exports = async snippet => {
  const tmp = await getTmp(generateTemplate(snippet))
  const dependencies = detectDependencies(tmp.content)
  await $(packageManager.init, { cwd: tmp.cwd })
  await $(`${packageManager.install} ${dependencies.join(' ')}`, {
    cwd: tmp.cwd
  })

  const result = await esbuild.build({
    entryPoints: [tmp.filepath],
    bundle: true,
    minify: MINIFY,
    write: false,
    platform: 'node'
  })

  await tmp.cleanup()
  return getTmp(result.outputFiles[0].text)
}

module.exports.detectDependencies = detectDependencies
