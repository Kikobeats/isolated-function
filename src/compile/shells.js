'use strict'

const { createHash } = require('crypto')

/**
 * Identifier a caller places in its snippet where per-call code goes. It is a
 * plain free identifier, so esbuild keeps it verbatim through bundling and
 * minification (globals are never renamed).
 */
const SLOT = '__ISOLATED_FUNCTION_SLOT__'

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

const UNSPLICEABLE = Symbol('unspliceable')

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

  /**
   * Resolves to the built shell content, or UNSPLICEABLE when the build does
   * not contain SLOT exactly once and so cannot be filled safely.
   */
  const get = (key, build) => {
    const cached = entries.get(key)
    if (cached !== undefined) {
      touch(key, cached)
      return cached.promise
    }

    const entry = { bytes: 0 }
    entry.promise = build().then(
      ({ content }) => {
        const value = occurrences(content, SLOT) === 1 ? content : UNSPLICEABLE
        if (entries.get(key) === entry) {
          admit(key, entry, value === UNSPLICEABLE ? 0 : Buffer.byteLength(content))
        }
        return value
      },
      error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      }
    )
    entries.set(key, entry)
    return entry.promise
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

const fill = (content, code) => content.replace(SLOT, () => `(${code})`)

module.exports = { SLOT, UNSPLICEABLE, DEFAULT_MAX_BYTES, createShells, keyOf, fill }
