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
        const dependency = node.arguments[0].value
        // Check if the dependency string contains '@' symbol for versioning
        if (dependency.includes('@')) {
          // Split by '@' to separate module name and version
          const parts = dependency.split('@')
          // Handle edge case where module name might also contain '@' (scoped packages)
          const moduleName = parts.length > 2 ? `${parts[0]}@${parts[1]}` : parts[0]
          const version = parts[parts.length - 1]
          dependencies.add(`${moduleName}@${version}`)
        } else {
          dependencies.add(`${dependency}@latest`)
        }
      }
    },
    ImportDeclaration (node) {
      const source = node.source.value
      if (source.includes('@')) {
        const parts = source.split('@')
        const moduleName = parts.length > 2 ? `${parts[0]}@${parts[1]}` : parts[0]
        const version = parts[parts.length - 1]
        dependencies.add(`${moduleName}@${version}`)
      } else {
        dependencies.add(`${source}@latest`)
      }
    }
  })

  return Array.from(dependencies)
}

const transformDependencies = code => {
  const ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' })

  let newCode = ''
  let lastIndex = 0

  // Helper function to process and transform nodes
  const processNode = node => {
    if (node.type === 'Literal' && node.value.includes('@')) {
      // Extract module name without version
      const [moduleName] = node.value.split('@')
      // Append code before this node
      newCode += code.substring(lastIndex, node.start)
      // Append transformed dependency
      newCode += `'${moduleName}'`
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

const getTmp = async content => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })

  const filepath = path.join(cwd, 'index.js')
  await fs.writeFile(filepath, content)

  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { filepath, cwd, content, cleanup }
}

module.exports = async snippet => {
  const compiledTemplate = generateTemplate(snippet)
  const dependencies = detectDependencies(compiledTemplate)
  const tmp = await getTmp(transformDependencies(compiledTemplate))

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
