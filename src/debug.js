'use strict'

const debug = require('debug-logfmt')('isolated-function')

const duration = async (name, fn) => {
  const duration = debug.duration(name)

  return Promise.resolve(fn())
    .then(result => {
      duration()
      return result
    })
    .catch(error => {
      duration.error()
      throw error
    })
}

module.exports = { debug, duration }
