'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const parseDependency = require('./parse-dependency')

// List of built-in Node.js modules
// https://github.com/sindresorhus/builtin-modules/blob/main/builtin-modules.json
const builtins = [
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib'
]

const isBuiltinModule = moduleName => {
  if (moduleName.startsWith('node:')) moduleName = moduleName.slice('node:'.length)
  return builtins.includes(moduleName)
}

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
        if (!isBuiltinModule(dependency)) dependencies.add(parseDependency(dependency))
      }
    },
    ImportDeclaration (node) {
      const source = node.source.value
      if (!isBuiltinModule(source)) dependencies.add(parseDependency(source))
    }
  })

  return Array.from(dependencies)
}

module.exports.parseDependency = parseDependency
