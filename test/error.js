/* eslint-disable */

const test = require('ava')

const isolatedFunction = require('..')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

test('throw an error if snippet is not a function or string', t => {
  t.throws(
    () => {
      isolatedFunction(NaN)
    },
    { message: 'Expected a function' }
  )
})

test('throw code errors by default', async t => {
  const [fn, cleanup] = isolatedFunction(() => {
    throw new TypeError('oops')
  })

  t.teardown(cleanup)
  await t.throwsAsync(fn(), { message: 'oops' })
})

test('pass `throwError: false`', async t => {
  {
    const [fn, cleanup] = isolatedFunction(
      () => {
        throw new TypeError('oops')
      },
      { throwError: false }
    )

    t.teardown(cleanup)
    const result = await fn()

    t.is(result.isFulfilled, false)
    t.is(result.value.message, 'oops')
    t.is(result.value.name, 'TypeError')
    t.is(typeof result.profiling, 'object')
  }
  {
    const [fn, cleanup] = isolatedFunction(
      () => {
        throw 'oops'
      },
      { throwError: false }
    )

    t.teardown(cleanup)
    const result = await fn()

    t.is(result.isFulfilled, false)
    t.is(result.value.message, '"oops"')
    t.is(result.value.name, 'NonError')
    t.is(typeof result.profiling, 'object')
  }
})

test('handle timeout', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      let i = 0
      while (true) {
        i += 1
      }
    },
    { timeout: 100 }
  )
  t.teardown(cleanup)

  const error = await t.throwsAsync(fn())

  t.is(error.message, 'Execution timed out')
  t.is(typeof error.profiling.duration, 'number')
})

test('handle OOM', async t => {
  const [fn, cleanup] = isolatedFunction(
    () => {
      const storage = []
      const twoMegabytes = 1024 * 1024 * 2
      while (true) {
        const array = new Uint8Array(twoMegabytes)
        for (let ii = 0; ii < twoMegabytes; ii += 4096) {
          array[ii] = 1 // we have to put something in the array to flush to real memory
        }
        storage.push(array)
      }
    },
    { memory: 1 }
  )
  t.teardown(cleanup)

  const error = await t.throwsAsync(fn())

  t.is(error.message, 'Out of memory')
  t.is(typeof error.profiling.duration, 'number')
})

test('handle filesystem permissions', async t => {
  {
    const [fn, cleanup] = isolatedFunction(() => {
      const fs = require('fs')
      fs.readFileSync('/etc/passwd', 'utf8')
    })

    t.teardown(cleanup)

    const error = await t.throwsAsync(fn())

    t.is(error.message, "Access to 'FileSystemRead' has been restricted")
  }
  {
    const [fn, cleanup] = isolatedFunction(() => {
      const fs = require('fs')
      fs.writeFileSync('/etc/passwd', 'foo')
    })

    t.teardown(cleanup)

    const error = await t.throwsAsync(fn())

    t.is(error.message, "Access to 'FileSystemWrite' has been restricted")
  }
})

test('handle child process', async t => {
  {
    const [fn, cleanup] = isolatedFunction(() => {
      const { execSync } = require('child_process')
      return execSync('echo hello').toString()
    })

    t.teardown(cleanup)

    const error = await t.throwsAsync(fn())

    t.is(error.message, "Access to 'ChildProcess' has been restricted")
  }
})

test('handle untrusted dependencies', async t => {
  const [fn] = isolatedFunction(
    () => {
      const malicious = require('malicious-package')
      return malicious()
    },
    { allow: { dependencies: ['lodash', 'axios'] } }
  )

  const error = await t.throwsAsync(fn())

  t.is(error.name, 'UntrustedDependencyError')
  t.is(error.message, "Dependency 'malicious-package' is not in the allowed list")
  t.is(error.dependency, 'malicious-package')
})
;(nodeMajor >= 25 ? test : test.skip)('handle network access', async t => {
  {
    const [fn, cleanup] = isolatedFunction(async () => {
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
    })

    t.teardown(cleanup)

    const error = await t.throwsAsync(fn())
    t.is(error.message, "Access to 'network' has been restricted")
  }
})
