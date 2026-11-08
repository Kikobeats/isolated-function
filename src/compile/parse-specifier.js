'use strict'

const { DependencyNameError } = require('../errors')

const UNSAFE_CHARACTERS = /[\\'"`\s]/

const VERSION_BEFORE_SUBPATH = /^(?:latest|\*|(?:[\^~])?v?\d[\d.xX*]*(?:-[\w.-]*)?(?:\+[\w.-]*)?)$/

const isDrivePrefix = segment => /^[A-Za-z]:/.test(segment)

const isPackageSegment = segment => {
  const bare = segment.startsWith('@') ? segment.slice(1) : segment
  return bare !== '' && bare !== '.' && bare !== '..' && !isDrivePrefix(bare)
}

const isPackagePath = subpath =>
  subpath === '' ||
  subpath
    .slice(1)
    .split('/')
    .every(
      segment => segment !== '' && segment !== '.' && segment !== '..' && !isDrivePrefix(segment)
    )

const splitVersion = rest => {
  if (!rest.startsWith('@')) return { version: undefined, subpath: rest }
  const version = rest.slice(1)
  const slashIndex = version.indexOf('/')
  const candidate = version.slice(0, slashIndex)
  return slashIndex !== -1 && VERSION_BEFORE_SUBPATH.test(candidate)
    ? { version: candidate, subpath: version.slice(slashIndex) }
    : { version, subpath: '' }
}

const nameEnd = specifier => {
  const scopeEnd = specifier.startsWith('@') ? Math.max(specifier.indexOf('/'), 0) + 1 : 0
  const match = specifier.slice(scopeEnd).search(/[@/]/)
  return match === -1 ? specifier.length : scopeEnd + match
}

module.exports = specifier => {
  const end = nameEnd(specifier)
  const name = specifier.slice(0, end)
  const parsed = { name, ...splitVersion(specifier.slice(end)) }
  if (
    name === '' ||
    name.startsWith('.') ||
    isDrivePrefix(name) ||
    !name.split('/').every(isPackageSegment) ||
    UNSAFE_CHARACTERS.test(specifier) ||
    !isPackagePath(parsed.subpath)
  ) {
    throw new DependencyNameError(specifier)
  }
  return parsed
}
