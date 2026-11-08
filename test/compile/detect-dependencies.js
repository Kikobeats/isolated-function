'use strict'

const test = require('ava')

const { detectDependencies } = require('../../src/compile')

test('detect requires', t => {
  const code = `
    const isEmoji = require('is-standard-emoji@1.0.0');
    const puppeteer = require('@cloudflare/puppeteer@1.2.3')
    const timeSpan = require('@kikobeats/timespan@latest')
    const isNumber = require('is-number@latest');
    const isString = require('is-string');
  `
  t.deepEqual(detectDependencies(code), [
    'is-standard-emoji@1.0.0',
    '@cloudflare/puppeteer@1.2.3',
    '@kikobeats/timespan@latest',
    'is-number@latest',
    'is-string@latest'
  ])
})

test('detect imports', t => {
  const code = `
    import puppeteer from '@cloudflare/puppeteer@1.2.3';
    import isEmoji from 'is-standard-emoji@1.0.0';
    import isNumber from 'is-number';
    import isString from 'is-string';
  `

  t.deepEqual(detectDependencies(code), [
    '@cloudflare/puppeteer@1.2.3',
    'is-standard-emoji@1.0.0',
    'is-number@latest',
    'is-string@latest'
  ])
})

test('detect builtin modules', t => {
  {
    const code = `
    const fs = require('node:fs');
    const http = require('http');
    const https = require('https');
    const path = require('path');
    const url = require('url');
    const fake = require('node:fake');
  `

    t.deepEqual(detectDependencies(code), ['node:fake@latest'])
  }
  {
    const code = `
    import fs from 'node:fs';
    import http from 'http';
    import https from 'https';
    import path from 'path';
    import url from 'url';
    import fake from 'node:fake';
  `
    t.deepEqual(detectDependencies(code), ['node:fake@latest'])
  }
})

test('a require of something other than a string is not a dependency', t => {
  const code = `
    const one = require(1)
    const nothing = require(null)
    const isNumber = require('is-number')
  `
  t.deepEqual(detectDependencies(code), ['is-number@latest'])
})

test('detect requires with a subpath', t => {
  const code = `
    const fp = require('lodash@4.17.21/fp')
    const timeSpan = require('@kikobeats/time-span/src/index.js')
  `
  t.deepEqual(detectDependencies(code), ['lodash@4.17.21', '@kikobeats/time-span@latest'])
})

for (const specifier of [
  'lodash/../../../../etc/hosts',
  'lodash@4.17.21/../../secret.js',
  '@scope/pkg/./index.js',
  '@scope/pkg@1.0.0/a/../../b',
  'lodash//fp',
  'lodash/fp/',
  './secret.json',
  '../secret.json',
  '/etc/hosts',
  '.'
]) {
  test(`a path outside a package is not a dependency: ${specifier}`, t => {
    const error = t.throws(() => detectDependencies(`const x = require('${specifier}')`))
    t.is(error.code, 'EDEPENDENCYNAME')
    t.is(error.dependency, specifier)
  })
}

test('an import of a path outside a package is not a dependency', t => {
  const error = t.throws(() => detectDependencies("import x from 'lodash/../../secret.js'"))
  t.is(error.code, 'EDEPENDENCYNAME')
})

test('a backslash in a specifier is not a dependency', t => {
  const error = t.throws(() =>
    detectDependencies(String.raw`const x = require('lodash@4.17.21/..\\/..\\/secret.json')`)
  )
  t.is(error.code, 'EDEPENDENCYNAME')
  t.is(error.dependency, String.raw`lodash@4.17.21/..\/..\/secret.json`)
})

for (const [label, code] of [
  ['dynamic import', "const x = await import('/etc/hosts')"],
  ['dynamic import with a relative path', "const x = await import('../../secret.json')"],
  ['export all from', "export * from '/etc/hosts'"],
  ['export named from', "export { default } from '../secret.json'"],
  ['template literal require', 'const x = require(`/etc/hosts`)'],
  ['template literal import', 'const x = await import(`lodash/../../secret.json`)']
]) {
  test(`${label} of a path outside a package is not a dependency`, t => {
    const error = t.throws(() => detectDependencies(code))
    t.is(error.code, 'EDEPENDENCYNAME')
  })
}

test('detect dynamic imports, export-from and template literals', t => {
  const code = `
    const isNumber = await import('is-number@7.0.0')
    export * from 'is-string'
    export { default as isEmoji } from 'is-standard-emoji@1.0.0'
    const fp = require(\`lodash@4.17.21/fp\`)
    const dynamic = await import(\`is-\${name}\`)
  `
  t.deepEqual(detectDependencies(code), [
    'is-number@7.0.0',
    'is-string@latest',
    'is-standard-emoji@1.0.0',
    'lodash@4.17.21'
  ])
})

for (const specifier of [
  "is-number@1.0.0/a'b",
  'is-number@1.0.0/a"b',
  'is-number@1.0.0/a`b',
  'is-number@^1 || ^2'
]) {
  test(`a quote or a space in a specifier is not a dependency: ${specifier}`, t => {
    const error = t.throws(() =>
      detectDependencies(`const x = require(${JSON.stringify(specifier)})`)
    )
    t.is(error.code, 'EDEPENDENCYNAME')
  })
}
