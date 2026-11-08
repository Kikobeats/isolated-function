'use strict'

const { builtinModules } = require('module')

const parseDependency = require('./parse-dependency')
const walkSpecifiers = require('./walk-specifiers')

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

const bareBuiltins = new Set(builtinModules.filter(name => !name.startsWith('node:')))

const nodeProtocolOnly = new Set([
  'ffi',
  ...builtinModules
    .filter(name => name.startsWith('node:'))
    .map(name => name.slice('node:'.length))
    .filter(name => !bareBuiltins.has(name))
])

const isBuiltinModule = moduleName => {
  const bare = moduleName.startsWith('node:') ? moduleName.slice('node:'.length) : moduleName
  if (moduleName.startsWith('node:') && nodeProtocolOnly.has(bare)) return true
  return builtins.includes(bare)
}

module.exports = code => {
  const dependencies = new Set()
  walkSpecifiers(code, specifier => {
    if (!isBuiltinModule(specifier)) dependencies.add(parseDependency(specifier))
  })
  return Array.from(dependencies)
}

module.exports.parseDependency = parseDependency
module.exports.isBuiltinModule = isBuiltinModule
