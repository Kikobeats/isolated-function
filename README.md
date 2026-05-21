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

# Why isolated-function?

Sometimes your application needs to let users customize a piece of behavior with JavaScript.

That code might be a function template for an AI agent, a customer-defined workflow, a plugin, a webhook transform, or an automation rule. You provide the shape of the function and the runtime context; users provide the custom logic. You want the useful part: programmable behavior without turning the rest of your application into the execution environment.

**isolated-function** gives you a small API for turning user-customizable function templates into controlled executions:

- give it a function or generated function template
- pass runtime arguments into it
- choose what it is allowed to do
- set memory and timeout limits
- run it
- get back the result, logs, errors, and timing data

It is useful when your product needs user-defined logic, but you still want a narrow execution contract around what that logic can receive, return, import, and access.

# What it does

At a high level, isolated-function wraps a JavaScript function and runs it away from your main process.

The core use case is giving your product a controlled function template that users can customize. Your application owns the template, runtime arguments, dependencies, permissions, timeout, memory, result shape, logging, and cleanup. Users only customize the part of the function you intentionally expose.

This is the pattern used by [`@browserless/function`](https://github.com/microlinkhq/browserless/tree/master/packages/function): it lets users build functions that can access a Puppeteer `page` and related browser context, then runs those functions through isolated-function.

It can:

- run untrusted code in a separate process
- restrict filesystem, network, worker, and child-process access through the [Node.js Permission Model](https://nodejs.org/api/permissions.html#permission-model)
- stop runaway code with memory, wall-clock, and CPU limits
- detect dependencies used by the function
- install and bundle those dependencies with [esbuild](https://esbuild.github.io/)
- reuse installed dependencies across executions
- allow only the packages you explicitly trust
- return profiling data for compile, spawn, run, and total time

# What it is not

isolated-function is not a virtual machine, microVM, container runtime, or hypervisor-based sandbox.

It isolates JavaScript by running it in a separate Node.js process with Node.js permissions and resource limits. That is useful for many plugin, workflow, webhook, and AI-agent use cases, but it is not the same security boundary as KVM, Firecracker, Kata Containers, gVisor, or another VM-backed isolation layer.

If you need to execute hostile multi-tenant code, use isolated-function behind a stronger runtime boundary such as a locked-down container, gVisor, Kata Containers, Firecracker, or another hypervisor-backed execution environment.

# Installation

```bash
pnpm add isolated-function
```

# Your first isolated function

First create an isolated-function instance. You can call it with no options:

```js
const isolatedFunction = require('isolated-function')()
```

Or pass shared options that apply to every function created from that instance:

```js
const isolatedFunction = require('isolated-function')({
  tmpdir: '/tmp/isolated-function-deps',
  nodePaths: [require('path').resolve(__dirname, 'node_modules')]
})
```

- tmpdir controls where isolated-function installs and reuses dependencies.
- nodePaths points to directories where dependencies may already be installed, so matching packages can skip installation.

Then wrap a normal JavaScript function:

```js
const sum = isolatedFunction((y, z) => y + z, {
  memory: 128, // in MB
  timeout: 10000 // in milliseconds
})
```

Now call it like any other async function:

```js
const { value, profiling } = await sum(3, 2)

console.log(value) // 5
console.log(profiling.total) // total execution time in milliseconds
```

When your application shuts down, clean up the shared dependency cache:

```js
await isolatedFunction.teardown()
```

That is the basic loop: create a sandboxed function, run it, read the result.

## Minimal privilege execution

By default, hosted code runs with minimal privileges. If it tries to use a restricted capability, isolated-function fails the execution instead of giving the code access.

For example, this function tries to write to `/etc/passwd`:

```js
const fn = isolatedFunction(() => {
  const fs = require('fs')
  fs.writeFileSync('/etc/passwd', 'foo')
})

await fn()
// => PermissionError: Access to 'FileSystemWrite' has been restricted.
```

The function ran in its own process, and the filesystem write was blocked.

## Granting specific permissions

Some functions need more access. Grant only the permissions that function needs with `allow.permissions`.

```js
const fn = isolatedFunction(
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
```

See [#allow.permissions](#permissions) for the full list.

## Auto install dependencies

Hosted code can bring its own dependencies. isolated-function parses `require` and `import` calls, installs the packages, and bundles the function before running it.

```js
const isEmoji = isolatedFunction(input => {
  /* this dependency only exists inside the isolated function */
  const isEmoji = require('is-standard-emoji@1.0.0') // default is latest
  return isEmoji(input)
})

await isEmoji('🙌') // => true
await isEmoji('foo') // => false
```

The hosted code and its dependencies are bundled into a single file with [esbuild](https://esbuild.github.io/) before execution.

Dependencies are installed into a shared persistent directory and reused across invocations, so only the first call that requires a given package pays the install cost.

## Restricting allowed dependencies

If the code is untrusted, do not let it install arbitrary packages. Use `allow.dependencies` to define the packages it may use:

```js
const fn = isolatedFunction(
  input => {
    const isEmoji = require('is-standard-emoji')
    return isEmoji(input)
  },
  {
    allow: { dependencies: ['is-standard-emoji', 'lodash'] }
  }
)

await fn('🙌') // => true
```

If the code tries to require a package not in the allowed list, a `DependencyUnallowedError` is thrown **before** any package install happens:

```js
const fn = isolatedFunction(
  () => {
    const malicious = require('malicious-package')
    return malicious()
  },
  {
    allow: { dependencies: ['lodash'] }
  }
)

await fn()
// => DependencyUnallowedError: Dependency 'malicious-package' is not in the allowed list
```

> **Security Note**: Even with the sandbox, arbitrary package installation is dangerous because packages can execute code during installation via `preinstall`/`postinstall` scripts. The `--ignore-scripts` flag is used to mitigate this, but providing an `allow.dependencies` whitelist is the recommended approach for running untrusted code.

## Execution profiling

Any hosted code execution will be run in their own separate process:

```js
/** make a function to consume ~128MB */
const fn = isolatedFunction(() => {
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

const { value, profiling } = await fn()
console.log(profiling)
// {
//   cpu: 42.5,
//   memory: 128204800,
//   phases: {
//     compile: 0,
//     spawn: 48,
//     run: 54,
//     total: 102
//   }
// }
```

Each execution includes profiling data:

- **cpu** — CPU time (user + system) consumed by the process, in milliseconds.
- **memory** — Peak RSS (Resident Set Size) of the process, in bytes.
- **phases** — Wall-clock time breakdown of each execution stage, in milliseconds:
  - **compile** — Time waiting for code compilation (dependency detection, package install, esbuild bundling). This is `0` after the first call since the result is cached.
  - **spawn** — Process creation, Node.js boot, and template setup overhead.
  - **run** — User function execution time.
  - **total** — End-to-end wall-clock time.

## Resource limits

You can limit a **isolated-function** with memory:

```js
const fn = isolatedFunction(() => {
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

or by execution time:

```js
const fn = isolatedFunction(() => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  await delay(duration)
  return 'done'
}, { timeout: 50 })

await fn(100)
// =>  TimeoutError: Execution timed out
```

The timeout option enforces both a wall-clock limit (`SIGKILL`) and a CPU time limit (`RLIMIT_CPU`). A CPU-bound infinite loop will be terminated by the kernel via `SIGXCPU`:

```js
const fn = isolatedFunction(() => {
  while (true) { Math.random() }
}, { timeout: 5000 })

await fn()
// => CpuTimeError: CPU time limit exceeded
```

## Logging

The logs are collected into a `logging` object returned after the execution:

```js
const fn = isolatedFunction(() => {
  console.log('console.log')
  console.info('console.info')
  console.debug('console.debug')
  console.warn('console.warn')
  console.error('console.error')
  return 'done'
})

const { logging } = await fn()

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
const fn = isolatedFunction(() => {
  throw new TypeError('oh no!')
})

const result = await fn()
// TypeError: oh no!
```

You can also return the error instead of throwing it with `{ throwError: false }`:

```js
const fn = isolatedFunction(
  () => {
    throw new TypeError('oh no!')
  },
  { throwError: false }
)

const { isFulfilled, value } = await fn()

if (!isFulfilled) {
  console.error(value)
  // TypeError: oh no!
}
```

# API

## isolatedFunction([options])

Creates an isolated-function instance. All functions created from the same instance share the same dependencies directory.

### options

#### tmpdir

Type: `string`<br>
Default: `path.join(os.tmpdir(), 'isolated-fn-deps')`

The directory used for installing code dependencies. Dependencies are installed once and reused across invocations, so only the first call that requires a given package pays the install cost.

```js
const isolatedFunction = require('isolated-function')({
  tmpdir: '/tmp/my-isolated-deps'
})
```

## => instance(code, [options])

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
Default: `true`

When `false`, returns the error instead of throwing it as `{ value: error, isFulfilled: false }`.

#### timeout

Type: `number`<br>
Default: `Infinity`

Timeout after a specified amount of time, in milliseconds. Enforces both a wall-clock limit (via `SIGKILL`) and a CPU time limit (via `RLIMIT_CPU`/`SIGXCPU`).

#### allow

Type: `object`<br>
Default: `{}`

Configuration object for allowed permissions and dependencies.

```js
const fn = isolatedFunction(
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

- `addons` — e.g. <small>*`require('native-module')`*</small><br/>
  Allow loading native C++ addons.

- `child-process` — e.g. <small>*`execSync('echo hello')`*</small><br/>
  Allow spawning child processes via `child_process` module.

- `ffi` *(Node.js v26+)* — e.g. <small>*`ffi.open('libc.so')`*</small><br/>
  Allow foreign function interface calls to shared libraries.

- `fs-read` — e.g. <small>*`fs.readFileSync('/etc/hosts')`*</small><br/>
  Allow reading from the filesystem. Supports path scoping: `fs-read=/etc/hosts`.

- `fs-write` — e.g. <small>*`fs.writeFileSync('/tmp/out.txt', data)`*</small><br/>
  Allow writing to the filesystem. Supports path scoping: `fs-write=/tmp`.

- `inspector` — e.g. <small>*`require('inspector').open()`*</small><br/>
  Allow the inspector protocol for debugging.

- `net` *(Node.js v25+)* — e.g. <small>*`http.get('http://example.com')`*</small><br/>
  Allow outbound network connections.

- `wasi` — e.g. <small>*`new WASI({ args, env })`*</small><br/>
  Allow WebAssembly System Interface operations.

- `worker` — e.g. <small>*`new Worker('./task.js')`*</small><br/>
  Allow creating worker threads.

##### dependencies

Type: `string[]`<br>
Default: `undefined`

A whitelist of package names that are allowed to be installed. When provided, only packages in this list can be required/imported by the isolated function.

This is a critical security feature when running untrusted code, as it prevents arbitrary package installation which could lead to remote code execution via malicious packages.

```js
const fn = isolatedFunction(
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

## => fn([...args])

Type: `function`

The isolated function to execute. You can pass arguments over it.

## instance.teardown()

Type: `function`

Removes the shared dependencies directory. Call this once when shutting down the server to clean up resources.

```js
await isolatedFunction.teardown()
```

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
