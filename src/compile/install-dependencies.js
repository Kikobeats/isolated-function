'use strict'

const { execSync } = require('child_process')
const { writeFile } = require('fs/promises')
const $ = require('tinyspawn')
const path = require('path')

const install = (() => {
  try {
    execSync('which pnpm').toString().trim()
    return 'pnpm install --no-lockfile --silent'
  } catch {
    return 'npm install --no-package-lock --silent'
  }
})()

module.exports = async ({ dependencies, cwd }) => {
  await writeFile(path.join(cwd, 'package.json'), '{}')
  return $(`${install} ${dependencies.join(' ')}`, { cwd })
}
