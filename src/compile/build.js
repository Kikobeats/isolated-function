'use strict'

const esbuild = require('esbuild')

const MINIFY = (() => {
  return process.env.ISOLATED_FUNCTIONS_MINIFY !== 'false'
    ? {}
    : {
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: true
      }
})()

module.exports = ({ content, cwd }) =>
  esbuild.build({
    stdin: {
      contents: content,
      resolveDir: cwd,
      sourcefile: 'index.js'
    },
    bundle: true,
    ...MINIFY,
    write: false,
    platform: 'node'
  })
