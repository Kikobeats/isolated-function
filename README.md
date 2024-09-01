# isolated-function

![Last version](https://img.shields.io/github/tag/Kikobeats/isolated-function.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/isolated-function.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/isolated-function)
[![NPM Status](https://img.shields.io/npm/dm/isolated-function.svg?style=flat-square)](https://www.npmjs.org/package/isolated-function)

**Highlights**

- Based in [Node.js Permission Model](https://nodejs.org/api/permissions.html#permission-model)
- Auto install npm dependencies.
- Memory limit support.
- Timeout support.

## Install

```bash
npm install isolated-function --save
```

## Usage

```js
const isolatedFunction = require('isolated-function')

/* This function will run in a sandbox, in a separate process */
const sum = isolatedFunction((y, z) => y + z)

/* Interact with it as usual from your main code */
const result = await sum(3, 2)

console.log(result)
```

You can also use `require' for external dependencies:

```js
const isEmoji = isolatedFunction(emoji => {
  const isEmoji = require('is-standard-emoji')
  return isEmoji(emoji)
})

await isEmoji('🙌') // => true
await isEmoji('foo') // => false
```

The dependencies are bundled with the source code into a single file that is executed in the sandbox.

It's intentionally not possible to expose any Node.js objects or functions directly to the sandbox (such as `process`, or filesystem). This makes it slightly harder to integrate into a project, but has the benefit of guaranteed isolation.

## API

### isolatedFunction(snippet, [options])

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

**isolated-function** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/isolated-function/blob/master/LICENSE.md) License.<br>
Authored and maintained by Kiko Beats with help from [contributors](https://github.com/Kikobeats/isolated-function/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [@Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
