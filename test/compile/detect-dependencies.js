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
