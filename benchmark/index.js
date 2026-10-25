'use strict'

const { mkdirSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const createIsolate = require('..')

const RUNS = 7
const ROOT = join(tmpdir(), `isolated-fn-bench-${process.pid}`)

const SNIPPET_EMPTY = '() => 1'
const SNIPPET_DEP = '() => require("@cloudflare/puppeteer") && 1'

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const ms = () => process.hrtime.bigint()

const elapsed = started => Number(ms() - started) / 1e6

const emptyDir = name => {
  const dir = join(ROOT, name.replaceAll(' ', '-'))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

const once = async (dir, snippet) => {
  const run = createIsolate({ tmpdir: dir })(snippet)
  return run()
}

const phaseMedian = (rows, key) => {
  const values = rows.map(row => row[key]).filter(value => typeof value === 'number')
  if (values.length === 0) return null
  return median(values)
}

const wipe = dir => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

const reusedRunner = (dir, snippet) => {
  const run = createIsolate({ tmpdir: dir })(snippet)
  return {
    warmup: () => run(),
    timed: () => run()
  }
}

const warmTree = (dir, snippet) => ({
  warmup: () => once(dir, snippet),
  timed: () => once(dir, snippet)
})

const coldLink = (dir, snippet) => ({
  warmup: async () => {
    await once(dir, snippet)
    wipe(dir)
  },
  before: () => wipe(dir),
  timed: () => once(dir, snippet)
})

const SPAWN_PHASES = ['spawn', 'run']
const ONESHOT_PHASES = ['install', 'build', 'spawn', 'run']

const CASES = [
  {
    name: 'spawn no deps',
    unit: 'child runs',
    snippet: SNIPPET_EMPTY,
    expected: 1,
    setup: reusedRunner,
    phaseKeys: SPAWN_PHASES
  },
  {
    name: 'spawn puppeteer',
    unit: 'child runs',
    snippet: SNIPPET_DEP,
    expected: 1,
    setup: reusedRunner,
    phaseKeys: SPAWN_PHASES
  },
  {
    name: 'oneshot warm puppeteer',
    unit: 'installs',
    snippet: SNIPPET_DEP,
    expected: 1,
    setup: warmTree,
    phaseKeys: ONESHOT_PHASES
  },
  {
    name: 'oneshot cold link puppeteer',
    unit: 'installs',
    snippet: SNIPPET_DEP,
    expected: 1,
    setup: coldLink,
    phaseKeys: ONESHOT_PHASES
  }
]

const takeSample = async (entry, ready, run) => {
  if (ready.before) ready.before()
  const started = ms()
  const reported = await ready.timed()
  const wall = elapsed(started)
  if (!reported.isFulfilled || reported.value !== entry.expected) {
    console.error(`${entry.name} run ${run} value ${reported.value}`)
    return { ok: false }
  }
  const phase = {}
  for (const key of entry.phaseKeys) phase[key] = reported.profiling.phases[key]
  return { ok: true, wall, phase }
}

const fmt = value => (value == null ? 'n/a' : value.toFixed(1))

const report = (entry, result) => {
  const med = result.walls.length ? median(result.walls) : Number.NaN
  const min = result.walls.length ? Math.min(...result.walls) : Number.NaN
  const max = result.walls.length ? Math.max(...result.walls) : Number.NaN
  const install = phaseMedian(result.phases, 'install')
  const build = phaseMedian(result.phases, 'build')
  const spawn = phaseMedian(result.phases, 'spawn')
  const run = phaseMedian(result.phases, 'run')
  const extra =
    `work ${result.work} ${entry.unit}, errors ${result.errors}, runs ${RUNS}, ` +
    `install ${fmt(install)} build ${fmt(build)} spawn ${fmt(spawn)} run ${fmt(run)}`
  console.log(`${entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(max)}  ${extra}`)
  return {
    name: entry.name,
    unit: 'ms',
    value: Number(med.toFixed(1)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const main = async () => {
  mkdirSync(ROOT, { recursive: true })
  const slots = []
  for (const entry of CASES) {
    const dir = emptyDir(entry.name)
    const ready = entry.setup(dir, entry.snippet)
    await ready.warmup()
    slots.push({ entry, ready, walls: [], phases: [], errors: 0 })
  }
  const results = []
  let errors = 0
  try {
    for (let run = 0; run < RUNS; run++) {
      for (const slot of slots) {
        try {
          const sample = await takeSample(slot.entry, slot.ready, run)
          if (!sample.ok) {
            slot.errors++
            continue
          }
          slot.walls.push(sample.wall)
          slot.phases.push(sample.phase)
        } catch (error) {
          slot.errors++
          console.error(error)
        }
      }
    }
    for (const slot of slots) {
      errors += slot.errors
      results.push(report(slot.entry, { ...slot, work: slot.walls.length }))
    }
  } finally {
    rmSync(ROOT, { recursive: true, force: true })
  }
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
