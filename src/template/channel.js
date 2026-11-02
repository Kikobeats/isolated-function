'use strict'

const { createLineReader, LINE_END, CLOSE_MESSAGE } = require('../channel')

const CHANNEL = '__isolatedChannel'
const CHANNEL_FD = 3

const open = `(() => {
  const fs = require('node:fs')
  const writeOutput = process.stdout.write.bind(process.stdout)
  const exit = process.exit.bind(process)
  const parse = JSON.parse
  const stringify = JSON.stringify
  const LINE_END = ${JSON.stringify(LINE_END)}
  const createLineReader = ${createLineReader.toString()}
  const input = fs.createReadStream(null, { fd: ${CHANNEL_FD}, encoding: 'utf8', autoClose: false })
  const output = fs.createWriteStream(null, { fd: ${CHANNEL_FD}, autoClose: false })
  const listeners = []
  const closeListeners = []
  let closed = false
  let broken = false

  input.on('data', createLineReader(line => {
    const message = parse(line)
    for (const listener of listeners) listener(message)
  }))

  const exitOnceOutputIsWritten = () => setImmediate(() => writeOutput('', () => exit()))

  const close = () => {
    if (closed) return
    closed = true
    if (broken) exitOnceOutputIsWritten()
    else output.end(LINE_END + ${JSON.stringify(JSON.stringify(CLOSE_MESSAGE))} + LINE_END)
    for (const listener of closeListeners) listener()
  }

  input.on('end', close)
  input.on('error', close)
  output.on('error', () => {
    broken = true
    if (closed) exitOnceOutputIsWritten()
  })

  return Object.freeze({
    send: (message, callback) => output.write(stringify(message) + LINE_END, callback),
    onMessage: listener => { listeners.push(listener) },
    onClose: listener => { closeListeners.push(listener) },
    close
  })
})()`

const source = hasChannel => `const ${CHANNEL} = ${hasChannel ? open : 'undefined'};\n`

module.exports = { source, CHANNEL, CHANNEL_FD }
