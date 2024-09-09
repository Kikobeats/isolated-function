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
