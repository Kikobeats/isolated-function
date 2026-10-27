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

const flatten = (object, prefix = '') =>
  Object.entries(object).reduce((fields, [key, value]) => {
    const name = prefix + key
    if (value !== null && typeof value === 'object') { Object.assign(fields, flatten(value, `${name}.`)) } else fields[name] = value
    return fields
  }, {})

module.exports = { debug, duration, flatten }
