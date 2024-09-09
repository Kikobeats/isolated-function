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
