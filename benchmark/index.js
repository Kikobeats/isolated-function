'use strict'

const { mkdirSync, rmSync } = require('fs')
const fs = require('fs/promises')
const path = require('path')

const transformDependencies = require('../src/compile/transform-dependencies')
const installDependencies = require('../src/compile/install-dependencies')
const detectDependencies = require('../src/compile/detect-dependencies')
const template = require('../src/template')
const build = require('../src/compile/build')

const createIsolatedFunction = require('..')

// @browserless/function template — generates the actual source that isolated-function compiles
// see: packages/function/src/template.js
const withResponse = `
  const { _response: _r, ...rest } = opts
  const response = _r
    ? Object.fromEntries(Object.entries(_r).map(([k, v]) => [k, () => v]))
    : undefined`

const browserlessFnTemplate = (code, usesPage) => {
  if (!usesPage) {
    return `async (url, _, opts) => {
    ${withResponse}
    return (${code})({ response, ...rest })
  }`
  }
  return `
    async (url, browserWSEndpoint, opts) => {
      ${withResponse}
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await puppeteer.connect({ browserWSEndpoint })
      const pages = await browser.pages()
      const { targetId } = opts
      let page
      if (targetId && pages.length > 1) {
        for (const p of pages) {
          try {
            const session = await p.createCDPSession()
            const { targetInfo } = await session.send('Target.getTargetInfo')
            await session.detach()
            if (targetInfo.targetId === targetId) { page = p; break }
          } catch {}
        }
      }
      if (!page) page = pages[pages.length - 1]
      try {
        return await (${code})({ page, response, ...rest })
      } finally {
        await browser.disconnect()
      }
    }`
}

// user functions as they arrive to @browserless/function
const USER_FN_NO_PAGE = '({ response }) => ({ statusCode: response.status() })'
const USER_FN_WITH_PAGE = '({ page }) => page.title()'

// what isolated-function actually receives after @browserless/function wraps them
const SNIPPET_NO_PAGE = browserlessFnTemplate(USER_FN_NO_PAGE, false)
const SNIPPET_WITH_PAGE = browserlessFnTemplate(USER_FN_WITH_PAGE, true)

const compileBefore = async snippet => {
  const cwd = await fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })

  let content = template(snippet)
  const dependencies = detectDependencies(content)

  if (dependencies.length) {
    content = transformDependencies(content)
    await installDependencies({ dependencies, cwd, allow: {} })
  }

  const result = await build({ content, cwd })
  content = result.outputFiles[0].text
  await cleanup()

  return content
}

const compileAfter = (() => {
  const isolatedFunction = createIsolatedFunction()
  return async snippet => {
    const fn = isolatedFunction(snippet)
    return fn
  }
})()

const fmt = ms => {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const bench = async (label, fn, iterations) => {
  const times = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }
  const first = times[0]
  const rest = times.slice(1)
  const avg = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : first
  console.log(`  ${label}`)
  console.log(`    1st call : ${fmt(first)}`)
  if (rest.length) console.log(`    avg (2-${iterations}): ${fmt(avg)}`)
  return { first, avg }
}

const { DEFAULT_TMPDIR } = require('../src/compile')

const cleanDepsDir = () => {
  rmSync(DEFAULT_TMPDIR, { recursive: true, force: true })
  mkdirSync(DEFAULT_TMPDIR, { recursive: true })
}

const run = async () => {
  const iterations = 5

  cleanDepsDir()

  console.log(`\n--- no page: no dependencies (${iterations} iterations) ---\n`)

  await bench('before (tmpdir per call)', () => compileBefore(SNIPPET_NO_PAGE), iterations)
  await bench('after  (shared deps dir)', () => compileAfter(SNIPPET_NO_PAGE), iterations)

  cleanDepsDir()

  console.log(`\n--- with page: @cloudflare/puppeteer (${iterations} iterations) ---\n`)

  await bench('before (tmpdir per call)', () => compileBefore(SNIPPET_WITH_PAGE), iterations)

  cleanDepsDir()

  await bench('after  (shared deps dir)', () => compileAfter(SNIPPET_WITH_PAGE), iterations)

  console.log()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
