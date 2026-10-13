// Every example in the README must parse, compile and build.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from '../src/engine/build.js'
import { layout } from '../src/engine/layout.js'
import { EXAMPLES, findExample } from '../src/examples.js'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
// numbered example rows: | # | Name | Space | Digits | Negative | [Limit |] Formulas | Note |
const rows = readme.split('\n').filter((l) => /^\| \d+ \|/.test(l) && l.split('|').length >= 9)
assert.equal(rows.length, 76)
const fromReadme = []
for (const row of rows) {
  const cells = row.split('|').map((s) => s.trim())
  const [, num, name, space, digits, negative] = cells
  const limit = cells.length === 10 ? Number(cells[6].replace('k', '000')) : 10000
  const formulas = cells[cells.length - 3]
  const f = [...formulas.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const dims = { 'ℤ': 1, 'ℤ²': 2, 'ℤ³': 3, 'ℤ⁴': 4, 'ℤ⁵': 5 }[space]
  assert.equal(f.length, dims, `#${num} ${name}: formula count`)
  const modulus = digits.startsWith('mod ') ? Number(digits.slice(4)) : undefined
  const g = build({ dims, digits: modulus ? String(modulus - 1).length : Number(digits), modulus, negative: negative === 'on', formulas: f, limit })
  layout(g.m, g.succ)
  fromReadme.push({ name, dims, digits: modulus ? String(modulus - 1).length : Number(digits), modulus, negative: negative === 'on', limit, f })
  if (process.env.VERBOSE) console.log(num, name, JSON.stringify(g.stats.census?.slice(0, 10)), 'leaves', g.stats.leaves, 'of', g.stats.totalStates, 'shown', g.m, 'cycles', g.stats.cycles, 'longest', g.stats.longest)
}
// The in-app Examples menu must offer exactly the README's configurations (plus the unnumbered 2-digit digit-append one).
const norm = (e) => ({ name: e.name, dims: e.dims, digits: e.digits, modulus: e.modulus, negative: !!e.negative, limit: e.limit ?? 10000, f: e.f })
const extra = 'Digit append, 2-digit blocks'
assert.deepEqual(EXAMPLES.filter((e) => e.name !== extra).map(norm), fromReadme)
const two = EXAMPLES.find((e) => e.name === extra)
assert.ok(two && two.f.every((f) => readme.includes('`' + f + '`')))
assert.equal(new Set(EXAMPLES.map((e) => e.name)).size, EXAMPLES.length)
// matching a typed formula back to an example
const q = (o) => findExample({ dims: 1, digits: 4, modulus: null, negative: false, ...o })
assert.equal(q({ formulas: ['DESC(a)-asc(a)'] }).example.name, 'Kaprekar (4)')
assert.deepEqual([q({ digits: 3, formulas: ['desc(a) - asc(a)'] }).example.name, q({ digits: 3, formulas: ['desc(a) - asc(a)'] }).exact], ['Kaprekar (3)', true])
assert.equal(q({ digits: 2, formulas: ['desc(a) - asc(a)'] }).exact, false)
assert.equal(q({ modulus: 997, formulas: ['a^2 + 1'] }).example.name, 'Rho over a prime field')
assert.equal(q({ negative: true, digits: 3, formulas: ['if(a mod 2 = 0, a/2, 3a + 1)'] }).example.name, 'Negative Collatz')
assert.equal(q({ formulas: ['a + 12345'] }), null)
console.log('readme examples ok')
