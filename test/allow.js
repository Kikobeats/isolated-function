'use strict'

const test = require('ava')

const isolatedFunction = require('..')()

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

test('child-process', async t => {
  const fn = isolatedFunction(
    () => {
      const { execSync } = require('child_process')
      return execSync('echo hello').toString().trim()
    },
    {
      allow: { permissions: ['child_process'] }
    }
  )

  const { value } = await fn()
  t.is(value, 'hello')
})
;(nodeMajor >= 25 ? test : test.skip)('network', async t => {
  const fn = isolatedFunction(
    async () => {
      function doFetch (url) {
        return new Promise((resolve, reject) => {
          const req = require('node:http').get(url, res => {
            let data = ''

            res.on('data', chunk => {
              data += chunk
            })

            res.on('end', () => {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: data
              })
            })
          })

          req.on('error', reject)
        })
      }

      const { statusCode } = await doFetch('http://example.com')
      return statusCode
    },
    {
      allow: { permissions: ['net'] }
    }
  )

  const { value } = await fn()
  t.is(value, 200)
})

test('worker', async t => {
  const fn = isolatedFunction(
    () => {
      const { Worker, isMainThread } = require('worker_threads')
      if (isMainThread) {
        return new Promise(resolve => {
          const worker = new Worker(
            'const { parentPort } = require("worker_threads"); parentPort.postMessage("hello")',
            { eval: true }
          )
          worker.on('message', resolve)
        })
      }
    },
    {
      allow: { permissions: ['worker'] }
    }
  )

  const { value } = await fn()
  t.is(value, 'hello')
})

test('fs-read with path scope', async t => {
  const fn = isolatedFunction(
    () => {
      const fs = require('fs')
      return fs.readFileSync('/etc/hosts', 'utf8').length > 0
    },
    {
      allow: { permissions: ['fs-read=/etc/hosts'] }
    }
  )

  const { value } = await fn()
  t.true(value)
})
