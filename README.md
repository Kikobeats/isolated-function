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
  - [Auto install dependencies](#auto-install-dependencies)
  - [Execution profiling](#execution-profiling)
  - [Resource limits](#resource-limits)
- [API](#api)
  - [isolatedFunction(code, \[options\])](#isolatedfunctioncode-options)
    - [code](#code)
    - [options](#options)
      - [timeout](#timeout)
      - [timeout](#timeout-1)
  - [=\> (fn(\[...args\]), teardown())](#-fnargs-teardown)
    - [fn](#fn)
    - [teardown](#teardown)
- [License](#license)

## Install

```bash
npm install isolated-function --save
```

## Quickstart

**isolated-function** is a modern solution for running untrusted code in Node.js.

```js
const isolatedFunction = require('isolated-function')

/* create an isolated-function, with resources limitation */
const [sum, teardown] = isolatedFunction((y, z) => y + z, {
  memory: 128, // in MB
  timeout: 10000 // in milliseconds
})

/* interact with the isolated-function */
const [value, profiling] = await sum(3, 2)
console.log({ value, profiling })

/* close resources associated with the isolated-function initialization */
await teardown()
```

### Minimal privilege execution

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

### Auto install dependencies

The hosted code is parsed for detecting `require`/`import` calls and install these dependencies:

```js
const [isEmoji, teardown] = isolatedFunction(emoji => {
  /* this dependency only exists inside the isolated function */
  const isEmoji = require('is-standard-emoji@1.0.0') // default is latest
  return isEmoji(emoji)
})

await isEmoji('🙌') // => true
await isEmoji('foo') // => false
await teardown()
```

The dependencies, along with the hosted code, are bundled by [esbuild](https://esbuild.github.io/) into a single file that will be evaluated at runtime.

### Execution profiling

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

const [value, profiling] = await fn()
console.log(profiling)
// {
//   memory: 128204800,
//   duration: 54.98325
// }
```

Each execution has a profile, which helps understand what happened.

### Resource limits

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

## API

### isolatedFunction(code, [options])

#### code

_Required_<br>
Type: `function`

The hosted function to run.

#### options

##### timeout

Type: `number`

Timeout after a specified amount of time, in milliseconds.

##### timeout

Type: `number`

Set the functino memory limit, in megabytes.

### => (fn([...args]), teardown())

#### fn

Type: `function`

The isolated function to execute. You can pass arguments over it.

#### teardown

Type: `function`

A function to be called to release resources associated with the **isolated-function**.

## License

**isolated-function** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/isolated-function/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/Kikobeats/isolated-function/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [@Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
