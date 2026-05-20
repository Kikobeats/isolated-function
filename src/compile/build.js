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

module.exports = ({ content, cwd, nodePaths = [] }) =>
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
    ...MINIFY
  })
