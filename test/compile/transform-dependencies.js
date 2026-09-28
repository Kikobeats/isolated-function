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
