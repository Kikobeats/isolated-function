'use strict'

const { createLineReader, LINE_END, CLOSE_MESSAGE } = require('../channel')

const CHANNEL = '__isolatedChannel'
const CHANNEL_FD = 3

const READ_SIZE = 64 * 1024

const open = `(() => {
  const fs = require('node:fs')
  const { StringDecoder } = require('node:string_decoder')
  const parse = JSON.parse
  const stringify = JSON.stringify
  const LINE_END = ${JSON.stringify(LINE_END)}
  const CLOSE_LINE = LINE_END + ${JSON.stringify(JSON.stringify(CLOSE_MESSAGE))} + LINE_END
  const createLineReader = ${createLineReader.toString()}
  const output = fs.createWriteStream(null, { fd: ${CHANNEL_FD}, autoClose: false })
  const decoder = new StringDecoder('utf8')
  const chunk = Buffer.alloc(${READ_SIZE})
  const listeners = []
  const closeListeners = []
  let awaiting = 0
  let reading = false
  let closed = false

  const receive = createLineReader(line => {
    awaiting = Math.max(0, awaiting - 1)
    const message = parse(line)
    for (const listener of listeners) listener(message)
  })

  const close = () => {
    if (closed) return
    closed = true
    output.end(reading ? CLOSE_LINE : undefined)
    for (const listener of closeListeners) listener()
  }

  const readWhileAwaiting = () => {
    if (reading || closed || awaiting === 0) return
    reading = true
    fs.read(${CHANNEL_FD}, chunk, 0, chunk.length, null, (error, bytes) => {
      reading = false
      if (error || bytes === 0) return close()
      receive(decoder.write(chunk.subarray(0, bytes)))
      readWhileAwaiting()
    })
  }

  output.on('error', close)

  return Object.freeze({
    send: (message, callback) => {
      awaiting++
      output.write(stringify(message) + LINE_END, callback)
      readWhileAwaiting()
    },
    onMessage: listener => { listeners.push(listener) },
    onClose: listener => { closeListeners.push(listener) },
    close
  })
})()`

const source = hasChannel => `const ${CHANNEL} = ${hasChannel ? open : 'undefined'};\n`

module.exports = { source, CHANNEL, CHANNEL_FD }
