'use strict'

const { createHash } = require('crypto')
const walk = require('acorn-walk')
const acorn = require('acorn')

const { isBuiltinModule } = require('./detect-dependencies')

/**
 * Identifier a caller places in its snippet where per-call code goes. It is a
 * plain free identifier, so esbuild keeps it verbatim through bundling and
 * minification (globals are never renamed).
 */
const SLOT = '__ISOLATED_FUNCTION_SLOT__'

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

/**
 * What a remembered "cannot be filled" verdict costs against the budget, so
 * that many distinct unspliceable snippets are evicted like anything else.
 */
const UNSPLICEABLE_BYTES = 1024

const UNSPLICEABLE = Symbol('unspliceable')

const COMMONJS_SCOPE = ['exports', 'require', 'module', '__filename', '__dirname']

/**
 * Slot code is wrapped as `(code\n)`: the newline ends a trailing `//`
 * comment before it can swallow the closing parenthesis.
 */
const asExpression = code => `(${code}\n)`

const parse = code => acorn.parse(asExpression(code), { ecmaVersion: 2023, sourceType: 'module' })

/**
 * Whether slot code needs esbuild to see it, so a cached shell cannot serve
 * it: it requires a package, loads one dynamically, or uses `import.meta`
 * (`new Function` rejects that, and esbuild rewrites it), or it mentions an
 * `esbuild.define` key (which only applies to code present at build time).
 * Parsing also rejects invalid code with the same SyntaxError a full build
 * would raise.
 */
const needsFullBuild = (code, esbuild) => {
  let needed = false

  walk.simple(parse(code), {
    ImportExpression () {
      needed = true
    },
    MetaProperty (node) {
      if (node.meta.name === 'import' && node.property.name === 'meta') needed = true
    },
    CallExpression (node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return
      const [specifier] = node.arguments
      const isLiteral = specifier?.type === 'Literal' && typeof specifier.value === 'string'
      if (!isLiteral || !isBuiltinModule(specifier.value)) needed = true
    }
  })

  const defined = Object.keys(esbuild?.define ?? {})
  return needed || defined.some(name => code.includes(name))
}

/**
 * Deterministic JSON with sorted keys, or `undefined` when a value cannot be
 * serialized faithfully (a function, e.g. an esbuild plugin). Such a build is
 * never cached, since two different plugins would produce the same key.
 */
const toKeyPart = value => {
  let serializable = true
  const json = JSON.stringify(value, (key, current) => {
    if (typeof current === 'function' || typeof current === 'symbol') serializable = false
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return Object.fromEntries(
        Object.keys(current)
          .sort()
          .map(name => [name, current[name]])
      )
    }
    return current
  })
  return serializable ? json ?? 'undefined' : undefined
}

const keyOf = (snippet, { tmpdir, allow, nodePaths, esbuild }) => {
  const options = toKeyPart({ tmpdir, dependencies: allow?.dependencies, nodePaths, esbuild })
  if (options === undefined) return undefined
  return createHash('sha256').update(snippet).update('\0').update(options).digest('hex')
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1

/**
 * Byte-bounded LRU of built shells. A shell is the build of a snippet that
 * still contains SLOT; it is reused for every call that only differs in what
 * goes into the slot. Entries are promises so concurrent calls share one build.
 * Resolves to `{ content, compiled }`, where `compiled` is the build result
 * for the call that performed it and `undefined` for every call served from
 * the cache, or to UNSPLICEABLE when SLOT did not survive exactly once.
 */
const createShells = ({ maxBytes = DEFAULT_MAX_BYTES } = {}) => {
  const entries = new Map()
  let bytes = 0

  const evict = key => {
    const entry = entries.get(key)
    if (entry === undefined) return
    entries.delete(key)
    bytes -= entry.bytes
  }

  const touch = (key, entry) => {
    entries.delete(key)
    entries.set(key, entry)
  }

  const admit = (key, entry, size) => {
    if (size > maxBytes) return evict(key)
    entry.bytes = size
    bytes += size
    for (const oldest of [...entries.keys()]) {
      if (bytes <= maxBytes) break
      if (oldest !== key) evict(oldest)
    }
  }

  const get = (key, build) => {
    const cached = entries.get(key)
    if (cached !== undefined) {
      touch(key, cached)
      return cached.promise.then(value => (value === UNSPLICEABLE ? value : { content: value }))
    }

    const entry = { bytes: 0 }
    let compiled
    entry.promise = build().then(
      result => {
        compiled = result
        const { content } = result
        const value = occurrences(content, SLOT) === 1 ? content : UNSPLICEABLE
        if (entries.get(key) === entry) {
          admit(
            key,
            entry,
            value === UNSPLICEABLE ? UNSPLICEABLE_BYTES : Buffer.byteLength(content)
          )
        }
        return value
      },
      error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      }
    )
    entries.set(key, entry)
    return entry.promise.then(value =>
      value === UNSPLICEABLE ? value : { content: value, compiled }
    )
  }

  return {
    get,
    clear: () => {
      entries.clear()
      bytes = 0
    },
    get size () {
      return entries.size
    },
    get bytes () {
      return bytes
    }
  }
}

/** Places slot code directly in a snippet, for a normal (full) build. */
const fillSource = (snippet, code) => snippet.replace(SLOT, () => asExpression(code))

/**
 * Places slot code in an already built shell. The code is not spliced in as
 * source: it becomes a string literal compiled at run time at global scope,
 * with the CommonJS module scope passed in. `this` is `exports`: that is what
 * esbuild rewrites top-level `this` to, and the runtime `this` where SLOT sits
 * is the module wrapper's this (globalThis when the isolate reads stdin).
 * Nothing esbuild did to the shell (renaming, tree shaking, hoisting a
 * dependency's top-level binding over a global) can change what the slot code
 * sees, and nothing in it can collide with the shell's own bindings.
 */
const fillShell = (content, code) => {
  const body = JSON.stringify(`return ${asExpression(code)}`)
  const compiled = `(new Function(${COMMONJS_SCOPE.map(name => `'${name}'`).join(
    ', '
  )}, ${body}).call(exports, ${COMMONJS_SCOPE.join(', ')}))`
  return content.replace(SLOT, () => compiled)
}

module.exports = {
  SLOT,
  UNSPLICEABLE,
  DEFAULT_MAX_BYTES,
  createShells,
  keyOf,
  needsFullBuild,
  fillSource,
  fillShell
}
