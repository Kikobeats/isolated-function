'use strict'

const esbuild = require('esbuild')
const path = require('path')

const { isBuiltinModule } = require('./detect-dependencies')
const walkSpecifiers = require('./walk-specifiers')

const ENTRY = 'index.js'

const MINIFY = (() => {
  return process.env.ISOLATED_FUNCTIONS_MINIFY === 'false'
    ? {}
    : {
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: true
      }
})()

const literalSpecifiers = content => {
  const specifiers = new Set()
  walkSpecifiers(content, specifier => specifiers.add(specifier))
  return specifiers
}

const isRuntimeModule = specifier => specifier.startsWith('node:') || isBuiltinModule(specifier)

const onlyLiteralSpecifiers = (entry, specifiers) => ({
  name: 'isolated-function:literal-specifiers',
  setup (build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.importer !== entry || specifiers.has(args.path) || isRuntimeModule(args.path)) {
        return
      }
      return {
        errors: [{ text: `Dependency '${args.path}' must be required with a string literal` }]
      }
    })
  }
})

module.exports = ({ content, cwd, nodePaths = [], esbuild: esbuildOpts = {} } = {}) =>
  esbuild.build({
    stdin: {
      contents: content,
      resolveDir: cwd,
      sourcefile: ENTRY
    },
    bundle: true,
    write: false,
    platform: 'node',
    legalComments: 'eof',
    target: 'node24',
    nodePaths,
    ...MINIFY,
    ...esbuildOpts,
    plugins: [
      onlyLiteralSpecifiers(path.join(cwd, ENTRY), literalSpecifiers(content)),
      ...(esbuildOpts.plugins ?? [])
    ]
  })
