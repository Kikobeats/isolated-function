'use strict'

const debug = require('debug-logfmt')('isolated-function')

module.exports = async (name, fn) => {
  const duration = debug.duration(name)

  return fn()
    .then(result => {
      duration()
      return result
    })
    .catch(error => {
      duration.error()
      throw error
    })
}

module.exports.debug = debug
