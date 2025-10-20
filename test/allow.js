'use strict'

const test = require('ava')

const isolatedFunction = require('..')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

test('child-process', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      const { execSync } = require('child_process')
      return execSync('echo hello').toString().trim()
    },
    {
      allow: ['child_process']
    }
  )

  t.teardown(cleanup)

  const { value } = await fn()
  t.is(value, 'hello')
})
;(nodeMajor >= 25 ? test : test.skip)('network', async t => {
  const [fn, cleanup] = isolatedFunction(
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
      allow: ['net']
    }
  )

  t.teardown(cleanup)

  const { value } = await fn()
  t.is(value, 200)
})
