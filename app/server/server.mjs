'use strict'

import isolatedFunction from 'isolated-function'
import { createServer } from 'http'
import send from 'send-http'
import prettyBytes from 'pretty-bytes'
import lz from 'lz-ts'

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  console.log(req.url)

  const url = new URL(req.url, `http://${req.headers.host}`)
  const compressedCode = url.searchParams.get('code')

  const code = lz.decompressFromURI(compressedCode)

  const [fn, teardown] = isolatedFunction(code, {
    memory: 32, // in MB
    timeout: 1000 // in milliseconds
  })

  const {value, profiling} = await fn()
  await teardown()

  send(res, 200, {
    value,
    profiling: {
      memory: prettyBytes(profiling.memory),
      duration: `${Math.round(profiling.duration)}ms`
    }
  })
})

server.listen(3001, () => {
  console.log('Server listening on port http://localhost:3001')
})
