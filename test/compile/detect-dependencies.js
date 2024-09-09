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
