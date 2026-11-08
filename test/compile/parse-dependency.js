'use strict'

const test = require('ava')

const parseDependency = require('../../src/compile/parse-dependency')

test('dependency with no version', t => {
  t.is(parseDependency('is-number'), 'is-number@latest')
})

test('dependency with version', t => {
  t.is(parseDependency('is-number@1.2.3'), 'is-number@1.2.3')
})

test('scoped dependency with no version', t => {
  t.is(parseDependency('@kikobeats/is-number'), '@kikobeats/is-number@latest')
})

test('scoped dependency with version', t => {
  t.is(parseDependency('@kikobeats/is-number@1.2.3'), '@kikobeats/is-number@1.2.3')
})

test('dependency with a subpath installs the package', t => {
  t.is(parseDependency('lodash/fp'), 'lodash@latest')
  t.is(parseDependency('lodash@4.17.21/fp'), 'lodash@4.17.21')
  t.is(
    parseDependency('fairy-stockfish-nnue.wasm@1.1.11/stockfish.js'),
    'fairy-stockfish-nnue.wasm@1.1.11'
  )
})

test('scoped dependency with a subpath installs the package', t => {
  t.is(parseDependency('@kikobeats/time-span/src/index.js'), '@kikobeats/time-span@latest')
  t.is(parseDependency('@kikobeats/time-span@1.0.5/src/index.js'), '@kikobeats/time-span@1.0.5')
})

test('dependency with a protocol keeps its slashes in the version', t => {
  t.is(
    parseDependency('is-number@github:jonschlinkert/is-number'),
    'is-number@github:jonschlinkert/is-number'
  )
})

test('dependency with a github shorthand keeps it as the version', t => {
  t.is(parseDependency('isarray@juliangruber/isarray'), 'isarray@juliangruber/isarray')
  t.is(parseDependency('isarray@juliangruber/isarray#main'), 'isarray@juliangruber/isarray#main')
})

test('dependency with a range and a subpath installs the range', t => {
  t.is(parseDependency('lodash@^4.17.0/fp'), 'lodash@^4.17.0')
  t.is(parseDependency('lodash@~4.17.0/fp'), 'lodash@~4.17.0')
  t.is(parseDependency('lodash@4.x/fp'), 'lodash@4.x')
  t.is(parseDependency('lodash@4.X/fp'), 'lodash@4.X')
  t.is(parseDependency('lodash@4.*/fp'), 'lodash@4.*')
  t.is(parseDependency('lodash@1.2.*/fp'), 'lodash@1.2.*')
  t.is(parseDependency('lodash@^4.*/fp'), 'lodash@^4.*')
  t.is(parseDependency('lodash@~4.*/fp'), 'lodash@~4.*')
  t.is(parseDependency('lodash@*/fp'), 'lodash@*')
  t.is(parseDependency('lodash@latest/fp'), 'lodash@latest')
  t.is(parseDependency('lodash@v4.17.21/fp'), 'lodash@v4.17.21')
  t.is(parseDependency('lodash@4.17.21-beta.1/fp'), 'lodash@4.17.21-beta.1')
  t.is(parseDependency('lodash@4.17.21-beta-1/fp'), 'lodash@4.17.21-beta-1')
  t.is(parseDependency('lodash@1.0.0+build/fp'), 'lodash@1.0.0+build')
  t.is(parseDependency('lodash@1.0.0+build.1/fp'), 'lodash@1.0.0+build.1')
  t.is(parseDependency('lodash@1.0.0+build-1/fp'), 'lodash@1.0.0+build-1')
})

test('dependency with a digit-leading github shorthand keeps it as the version', t => {
  t.is(parseDependency('isarray@4foo/isarray'), 'isarray@4foo/isarray')
})
