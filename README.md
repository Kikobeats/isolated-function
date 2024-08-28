# run-sandbox

![Last version](https://img.shields.io/github/tag/Kikobeats/run-sandbox.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/run-sandbox.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/run-sandbox)
[![NPM Status](https://img.shields.io/npm/dm/run-sandbox.svg?style=flat-square)](https://www.npmjs.org/package/run-sandbox)

> Runs untrusted code in a Node.js v8 sandbox. Built on top of [v8-sandbox](https://github.com/fulcrumapp/v8-sandbox).

## Install

```bash
npm install run-sandbox --save
```

## Usage

```js
const runSandbox = require('run-sandbox')

/* This function will run in a sandbox, in a separate process */
const sum = runSandbox((y, z) => y + z)

/* Interact with it as usual from your main code */
const result = await sum(3, 2)

console.log(result)
```

You can also use `require' for external dependencies:

```js
const isEmoji = runSandbox(emoji => {
  const isEmoji = require('is-standard-emoji')
  return isEmoji(emoji)
})

await isEmoji('🙌') // => true
await isEmoji('foo') // => false
```

The dependencies are bundled with the source code into a single file that is executed in the sandbox.

It's intentionally not possible to expose any Node.js objects or functions directly to the sandbox (such as `process`, or filesystem). This makes it slightly harder to integrate into a project, but has the benefit of guaranteed isolation.

## API

### runSandbox(snippet, [options])

#### snippet

*Required*<br>
Type: `string`

The source code to run.

#### options

##### foo

Type: `boolean`<br>
Default: `false`

Lorem ipsum.

## License

**run-sandbox** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/run-sandbox/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/Kikobeats/run-sandbox/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [@Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
