<h3 align="center">
  <img
    src="https://github.com/Kikobeats/isolated-function/blob/master/logo.png?raw=true"
    width="200">
  <br>
  <p>isolated-function</p>
  <a target="_blank" rel="noopener noreferrer nofollow"><img
      src="https://img.shields.io/github/tag/Kikobeats/isolated-function.svg?style=flat-square"
      style="max-width: 100%;"></a>
  <a href="https://coveralls.io/github/Kikobeats/isolated-function"
    rel="nofollow"><img
      src="https://img.shields.io/coveralls/Kikobeats/isolated-function.svg?style=flat-square"
      alt="Coverage Status" style="max-width: 100%;"></a>
  <a href="https://www.npmjs.org/package/isolated-function" rel="nofollow"><img
      src="https://img.shields.io/npm/dm/isolated-function.svg?style=flat-square"
      alt="NPM Status" style="max-width: 100%;"></a>
</h3>

- [Install](#install)
- [Quickstart](#quickstart)
  - [Minimal privilege execution](#minimal-privilege-execution)
  - [Granting specific permissions](#granting-specific-permissions)
  - [Auto install dependencies](#auto-install-dependencies)
  - [Restricting allowed dependencies](#restricting-allowed-dependencies)
  - [Execution profiling](#execution-profiling)
  - [Resource limits](#resource-limits)
  - [Logging](#logging)
  - [Error handling](#error-handling)
- [API](#api)
  - [isolatedFunction(code, \[options\])](#isolatedfunctioncode-options)
    - [code](#code)
    - [options](#options)
      - [memory](#memory)
      - [throwError](#throwerror)
      - [timeout](#timeout)
      - [tmpdir](#tmpdir)
      - [allow](#allow)
        - [permissions](#permissions)
        - [dependencies](#dependencies)
  - [=\> (fn(\[...args\]), teardown())](#-fnargs-teardown)
    - [fn](#fn)
    - [teardown](#teardown)
- [Environment Variables](#environment-variables)
    - [`ISOLATED_FUNCTIONS_MINIFY`](#isolated_functions_minify)
    - [`DEBUG`](#debug)
- [License](#license)



# Install

```bash
npm install isolated-function --save
```

# Quickstart

**isolated-function** is a modern solution for running untrusted code in Node.js.

```js
const isolatedFunction = require('isolated-function')

/* create an isolated-function, with resources limitation */
const [sum, teardown] = isolatedFunction((y, z) => y + z, {
  memory: 128, // in MB
  timeout: 10000 // in milliseconds
})

/* interact with the isolated-function */
const { value, profiling } = await sum(3, 2)

/* close resources associated with the isolated-function initialization */
await teardown()
```

## Minimal privilege execution

The hosted code runs in a separate process, with minimal privilege, using [Node.js permission model API](https://nodejs.org/api/permissions.html#permission-model).

```js
const [fn, teardown] = isolatedFunction(() => {
  const fs = require('fs')
  fs.writeFileSync('/etc/passwd', 'foo')
})

await fn()
// => PermissionError: Access to 'FileSystemWrite' has been restricted.
```

If you exceed your limit, an error will occur. Any of the following interaction will throw an error:

- Native modules
- Child process
- Worker Threads
- Inspector protocol
- File system access
- WASI

## Granting specific permissions

You can grant specific permissions to the isolated function using the `allow.permissions` option:

```js
const [fn, teardown] = isolatedFunction(
  () => {
    const { execSync } = require('child_process')
    return execSync('echo hello').toString().trim()
  },
  {
    allow: { permissions: ['child-process'] }
  }
)

const { value } = await fn()
console.log(value) // 'hello'
await teardown()
```

See [#allow.permissions](#permissions) to know more.

## Auto install dependencies

The hosted code is parsed for detecting `require`/`import` calls and install these dependencies:

```js
const [isEmoji, teardown] = isolatedFunction(input => {
  /* this dependency only exists inside the isolated function */
  const isEmoji = require('is-standard-emoji@1.0.0') // default is latest
  return isEmoji(input)
})

await isEmoji('🙌') // => true
await isEmoji('foo') // => false
await teardown()
```

The dependencies, along with the hosted code, are bundled by [esbuild](https://esbuild.github.io/) into a single file that will be evaluated at runtime.

## Restricting allowed dependencies

When running untrusted code, you should restrict which npm packages can be installed to prevent supply chain attacks:

```js
const [fn, teardown] = isolatedFunction(
  input => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(input)
  },
  {
    allow: { dependencies: ['is-standard-emoji', 'lodash'] }
  }
)

await fn('🙌') // => true
await teardown()
```

If the code tries to require a package not in the allowed list, an `UntrustedDependencyError` is thrown **before** any npm install happens:

```js
const [fn, teardown] = isolatedFunction(
  () => {
    const malicious = require('malicious-package')
    return malicious()
  },
  {
    allow: { dependencies: ['lodash'] }
  }
)

await fn()
// => UntrustedDependencyError: Dependency 'malicious-package' is not in the allowed list
```

> **Security Note**: Even with the sandbox, arbitrary package installation is dangerous because npm packages can execute code during installation via `preinstall`/`postinstall` scripts. The `--ignore-scripts` flag is used to mitigate this, but providing an `allow.dependencies` whitelist is the recommended approach for running untrusted code.

## Execution profiling

Any hosted code execution will be run in their own separate process:

```js
/** make a function to consume ~128MB */
const [fn, teardown] = isolatedFunction(() => {
  const storage = []
  const oneMegabyte = 1024 * 1024
  while (storage.length < 78) {
    const array = new Uint8Array(oneMegabyte)
    for (let ii = 0; ii < oneMegabyte; ii += 4096) {
      array[ii] = 1
    }
    storage.push(array)
  }
})
t.teardown(cleanup)

const { value, profiling } = await fn()
console.log(profiling)
// {
//   memory: 128204800,
//   duration: 54.98325
// }
```

Each execution has a profiling, which helps understand what happened.

## Resource limits

You can limit a **isolated-function** by memory:

```js
const [fn, teardown] = isolatedFunction(() => {
  const storage = []
  const oneMegabyte = 1024 * 1024
  while (storage.length < 78) {
    const array = new Uint8Array(oneMegabyte)
    for (let ii = 0; ii < oneMegabyte; ii += 4096) {
      array[ii] = 1
    }
    storage.push(array)
  }
}, { memory: 64 })

await fn()
// =>  MemoryError: Out of memory
```

or by execution duration:

```js
const [fn, teardown] = isolatedFunction(() => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  await delay(duration)
  return 'done'
}, { timeout: 50 })

await fn(100)
// =>  TimeoutError: Execution timed out
```

## Logging

The logs are collected into a `logging` object returned after the execution:

```js
const [fn, teardown] = isolatedFunction(() => {
  console.log('console.log')
  console.info('console.info')
  console.debug('console.debug')
  console.warn('console.warn')
  console.error('console.error')
  return 'done'
})

const { logging } await fn()

console.log(logging)
// {
//   log: ['console.log'],
//   info: ['console.info'],
//   debug: ['console.debug'],
//   warn: ['console.warn'],
//   error: ['console.error']
// }
```

## Error handling

Any error during **isolated-function** execution will be propagated:

```js
const [fn, cleanup] = isolatedFunction(() => {
  throw new TypeError('oh no!')
})

const result = await fn()
// TypeError: oh no!
```

You can also return the error instead of throwing it with `{ throwError: false }`:

```js
const [fn, cleanup] = isolatedFunction(() => {
  throw new TypeError('oh no!')
})

const { isFullfiled, value } = await fn()

if (!isFufilled) {
  console.error(value)
  // TypeError: oh no!
}
```

# API

## isolatedFunction(code, [options])

### code

_Required_<br>
Type: `function`

The hosted function to run.

### options

#### memory

Type: `number`<br>
Default: `Infinity`

Set the function memory limit, in megabytes.

#### throwError

Type: `boolean`<br>
Default: `false`

When is `true`, it returns the error rather than throw it.

The error will be accessible against `{ value: error, isFufilled: false }` object.

Set the function memory limit, in megabytes.

#### timeout

Type: `number`<br>
Default: `Infinity`

Timeout after a specified amount of time, in milliseconds.

#### tmpdir

Type: `function`<br>

It setup the temporal folder to be used for installing code dependencies.

The default implementation is:

```js
const tmpdir = async () => {
  const cwd = await fs.mkdtemp(path.join(require('os').tmpdir(), 'compile-'))
  await fs.mkdir(cwd, { recursive: true })
  const cleanup = () => fs.rm(cwd, { recursive: true, force: true })
  return { cwd, cleanup }
}
```

#### allow

Type: `object`<br>
Default: `{}`

Configuration object for allowed permissions and dependencies.

```js
const [fn, cleanup] = isolatedFunction(
  () => {
    const { execSync } = require('child_process')
    const lodash = require('lodash')
    return lodash.uniq([1, 2, 2, 3])
  },
  {
    allow: {
      permissions: ['child-process'],
      dependencies: ['lodash']
    }
  }
)
```

##### permissions

Type: `string[]`<br>
Default: `[]`

An array of permissions to grant to the isolated function based on [Node.js Options](https://nodejs.org/api/cli.html#options)

When empty, the function runs with minimal privileges and will throw an error if it attempts to access restricted resources. Available permissions are:

- `addons`
- `child-process`
- `fs-read`
- `fs-write`
- `inspector`
- `net`
- `wasi`
- `worker`

Example:

```js
const [fn, cleanup] = isolatedFunction(
  async () => {
    const http = require('node:http')
    // Network request code here
  },
  {
    allow: { permissions: ['net'] }
  }
)
```

##### dependencies

Type: `string[]`<br>
Default: `undefined`

A whitelist of npm package names that are allowed to be installed. When provided, only packages in this list can be required/imported by the isolated function.

This is a critical security feature when running untrusted code, as it prevents arbitrary package installation which could lead to remote code execution via malicious packages.

```js
const [fn, cleanup] = isolatedFunction(
  () => {
    const lodash = require('lodash')
    const axios = require('axios')
    return lodash.get({ a: 1 }, 'a')
  },
  {
    allow: { dependencies: ['lodash', 'axios'] }
  }
)
```

When `allow.dependencies` is not provided, any package can be installed (default behavior for backwards compatibility).

## => (fn([...args]), teardown())

### fn

Type: `function`

The isolated function to execute. You can pass arguments over it.

### teardown

Type: `function`

A function to be called to release resources associated with the **isolated-function**.

# Environment Variables

### `ISOLATED_FUNCTIONS_MINIFY`

Default: `true`

When is `false`, it disabled minify the compiled code.

### `DEBUG`

Pass `DEBUG=isolated-function` for enabling debug timing output.

# License

**isolated-function** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/isolated-function/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/Kikobeats/isolated-function/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [@Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
