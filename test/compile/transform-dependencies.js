'use strict'

const test = require('ava')

const { transformDependencies } = require('../../src/compile')

test('detect requires', t => {
  const code = `
    const isEmoji = require('is-standard-emoji@1.0.0');
    const puppeteer = require('@cloudflare/puppeteer@1.2.3')
    const isNumber = require('is-number');
    const isString = require('is-string');`

  t.deepEqual(
    transformDependencies(code),
    `
    const isEmoji = require('is-standard-emoji');
    const puppeteer = require('@cloudflare/puppeteer')
    const isNumber = require('is-number');
    const isString = require('is-string');`
  )
})

test('rewrites two versions of one package to alias names', t => {
  const code = `
    const five = require('is-number@5.0.0');
    const six = require('is-number@6.0.0');`
  const requireAs = new Map([
    ['is-number@5.0.0', 'is-number-5.0.0'],
    ['is-number@6.0.0', 'is-number-6.0.0']
  ])

  t.is(
    transformDependencies(code, requireAs),
    `
    const five = require('is-number-5.0.0');
    const six = require('is-number-6.0.0');`
  )
})

test('detect imports', t => {
  const code = `
    import puppeteer from '@cloudflare/puppeteer@1.2.3';
    import isEmoji from 'is-standard-emoji@1.0.0';
    import isNumber from 'is-number';
    import isString from 'is-string';`

  t.deepEqual(
    transformDependencies(code),
    `
    import puppeteer from '@cloudflare/puppeteer';
    import isEmoji from 'is-standard-emoji';
    import isNumber from 'is-number';
    import isString from 'is-string';`
  )
})

test('keeps the subpath after removing the version', t => {
  const code = `
    const fp = require('lodash@4.17.21/fp');
    const timeSpan = require('@kikobeats/time-span@1.0.5/src/index.js');
    import get from 'lodash/get';
    const one = require(1);`

  t.is(
    transformDependencies(code),
    `
    const fp = require('lodash/fp');
    const timeSpan = require('@kikobeats/time-span/src/index.js');
    import get from 'lodash/get';
    const one = require(1);`
  )
})

test('keeps the subpath after an alias name', t => {
  const code = `
    const five = require('is-number@5.0.0/index.js');
    const six = require('is-number@6.0.0');`
  const requireAs = new Map([
    ['is-number@5.0.0', 'is-number-5.0.0'],
    ['is-number@6.0.0', 'is-number-6.0.0']
  ])

  t.is(
    transformDependencies(code, requireAs),
    `
    const five = require('is-number-5.0.0/index.js');
    const six = require('is-number-6.0.0');`
  )
})

test('leaves a specifier that already matches its alias', t => {
  const code = 'const five = require("is-number@5.0.0");'
  const template = 'const five = require(`is-number@5.0.0`);'
  const requireAs = new Map([['is-number@5.0.0', 'is-number@5.0.0']])

  t.is(transformDependencies(code, requireAs), code)
  t.is(transformDependencies(template, requireAs), template)
})

test('keeps a star range subpath and rewrites require.resolve', t => {
  const code = `
    const fp = require('lodash@4.*/fp');
    const resolved = require.resolve('is-number@1.2.3/index.js');
    const loaded = module.require('is-number@1.2.3/index.js');`

  t.is(
    transformDependencies(code),
    `
    const fp = require('lodash/fp');
    const resolved = require.resolve('is-number/index.js');
    const loaded = module.require('is-number/index.js');`
  )
})

test('rewrites dynamic imports, export-from and template literals', t => {
  const code = `
    const isNumber = await import('is-number@7.0.0');
    export * from 'is-string@1.0.0';
    export { default as isEmoji } from 'is-standard-emoji@1.0.0';
    const fp = require(\`lodash@4.17.21/fp\`);
    const dynamic = await import(\`is-\${name}\`);`

  t.is(
    transformDependencies(code),
    `
    const isNumber = await import('is-number');
    export * from 'is-string';
    export { default as isEmoji } from 'is-standard-emoji';
    const fp = require('lodash/fp');
    const dynamic = await import(\`is-\${name}\`);`
  )
})
