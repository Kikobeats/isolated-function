'use strict'

const esbuild = require('esbuild')

const MINIFY = (() => {
  return process.env.ISOLATED_FUNCTIONS_MINIFY === 'false'
    ? {}
    : {
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: true
      }
})()

// @cloudflare/puppeteer vendors the whole of rxjs. Keep the operators the isolate actually calls.
const PUPPETEER_RXJS = {
  name: 'puppeteer-rxjs',
  setup (build) {
    build.onResolve({ filter: /(?:^|\/)third_party\/rxjs\/rxjs\.js$/ }, () => ({
      path: require.resolve('./rxjs-runtime.cjs')
    }))
  }
}

module.exports = ({ content, cwd, nodePaths = [], esbuild: esbuildOpts } = {}) =>
  esbuild.build({
    stdin: {
      contents: content,
      resolveDir: cwd,
      sourcefile: 'index.js'
    },
    bundle: true,
    write: false,
    platform: 'node',
    legalComments: 'eof',
    target: 'node24',
    nodePaths,
    ...MINIFY,
    ...esbuildOpts,
    plugins: [PUPPETEER_RXJS, ...(esbuildOpts?.plugins ?? [])]
  })
