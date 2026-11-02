'use strict'

const { EventEmitter } = require('events')

const LINE_END = '\n'
const CLOSE_MESSAGE = { close: true }

const isClose = message => message !== null && typeof message === 'object' && message.close === true

const ignoreClosedPipe = () => {}

const createLineReader = deliver => {
  let pieces = []
  return chunk => {
    let start = 0
    let end
    while ((end = chunk.indexOf(LINE_END, start)) !== -1) {
      pieces.push(chunk.slice(start, end))
      deliver(pieces.join(''))
      pieces = []
      start = end + 1
    }
    if (start < chunk.length) pieces.push(chunk.slice(start))
  }
}

const createChannel = stream => {
  const channel = new EventEmitter()

  const deliver = line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (isClose(message)) return stream.end()
    channel.emit('message', message)
  }

  stream.setEncoding('utf8')
  stream.on('data', createLineReader(deliver))
  stream.on('end', () => stream.end())
  stream.on('error', ignoreClosedPipe)

  Object.defineProperty(channel, 'connected', {
    get: () => stream.writable && !stream.destroyed
  })
  channel.send = (message, callback) => stream.write(JSON.stringify(message) + LINE_END, callback)

  return channel
}

module.exports = { createChannel, createLineReader, LINE_END, CLOSE_MESSAGE }
