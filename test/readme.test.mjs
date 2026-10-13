// Every example in the README must parse, compile and build.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from '../src/engine/build.js'
import { layout } from '../src/engine/layout.js'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
// numbered example rows: | # | Name | Space | Digits | Negative | [Limit |] Formulas | Note |
const rows = readme.split('\n').filter((l) => /^\| \d+ \|/.test(l) && l.split('|').length >= 9)
assert.equal(rows.length, 66)
for (const row of rows) {
  const cells = row.split('|').map((s) => s.trim())
  const [, num, name, space, digits, negative] = cells
  const limit = cells.length === 10 ? Number(cells[6].replace('k', '000')) : 10000
  const formulas = cells[cells.length - 3]
  const f = [...formulas.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const dims = { 'ℤ': 1, 'ℤ²': 2, 'ℤ³': 3, 'ℤ⁴': 4, 'ℤ⁵': 5 }[space]
  assert.equal(f.length, dims, `#${num} ${name}: formula count`)
  const g = build({ dims, digits: Number(digits), negative: negative === 'on', formulas: f, limit })
  layout(g.m, g.succ)
  if (process.env.VERBOSE) console.log(num, name, JSON.stringify(g.stats.census?.slice(0, 10)), 'leaves', g.stats.leaves, 'of', g.stats.totalStates, 'shown', g.m, 'cycles', g.stats.cycles, 'longest', g.stats.longest)
}
console.log('readme examples ok')
