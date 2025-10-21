'use strict'

const { execSync } = require('child_process')
const $ = require('tinyspawn')

const install = (() => {
  try {
    execSync('which pnpm', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return 'pnpm install --no-lockfile --silent'
  } catch {
    return 'npm install --no-package-lock --silent'
  }
})()

module.exports = async ({ dependencies, cwd }) => {
  return $(`${install} ${dependencies.join(' ')}`, { cwd })
}
