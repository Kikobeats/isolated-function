'use strict'

const { execSync } = require('child_process')
const { writeFile } = require('fs/promises')
const $ = require('tinyspawn')
const path = require('path')

const install = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return 'pnpm install'
  } catch {
    return 'npm install'
  }
})()

module.exports = async ({ dependencies, cwd }) => {
  await writeFile(path.join(cwd, 'package.json'), '{}')
  return $(`${install} ${dependencies.join(' ')}`, { cwd })
}
