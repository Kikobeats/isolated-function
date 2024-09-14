'use strict'

const debug = require('debug-logfmt')('isolated-function')

const duration = async (name, fn, props) => {
  const duration = debug.duration(name)

  return Promise.resolve(fn())
    .then(result => {
      props ? duration(props) : duration()
      return result
    })
    .catch(error => {
      props ? duration.error(props) : duration.duration.error()
      throw error
    })
}

module.exports = { debug, duration }
