import assert from 'node:assert/strict'
import { parse } from '../src/engine/parser.js'
import { compile } from '../src/engine/compile.js'
import { build, BUDGET } from '../src/engine/build.js'
import { layout } from '../src/engine/layout.js'

// --- reference evaluator: exact BigInt tree walk ---
function ev(n, v) {
  switch (n.t) {
    case 'num': return BigInt(n.raw)
    case 'var': return BigInt(v[n.i])
    case 'neg': return -ev(n.x, v)
    case 'add': return ev(n.l, v) + ev(n.r, v)
    case 'sub': return ev(n.l, v) - ev(n.r, v)
    case 'mul': return ev(n.l, v) * ev(n.r, v)
    case 'mod': { const x = ev(n.l, v), y = ev(n.r, v); if (y === 0n) return x; const r = x % y; return r !== 0n && (r < 0n) !== (y < 0n) ? r + y : r }
    case 'pow': { const b = ev(n.l, v), e = ev(n.r, v); if (e < 0n) return b === 1n ? 1n : b === -1n ? (e % 2n ? -1n : 1n) : 0n; return b ** e }
    case 'call': {
      if (n.f === 'if') return ev(n.args[0], v) !== 0n ? ev(n.args[1], v) : ev(n.args[2], v)
      const [x, y] = n.args.map((k) => ev(k, v))
      const abs = (t) => (t < 0n ? -t : t), str = (t) => abs(t).toString(), sg = (t, r) => (t < 0n ? -BigInt(r) : BigInt(r))
      const floorDiv = (p, q) => { if (q === 0n) return 0n; let k = p / q; if (k * q !== p && (p < 0n) !== (q < 0n)) k -= 1n; return k }
      switch (n.f) {
        case 'div': return floorDiv(x, y)
        case 'lt': return x < y ? 1n : 0n
        case 'le': return x <= y ? 1n : 0n
        case 'gt': return x > y ? 1n : 0n
        case 'ge': return x >= y ? 1n : 0n
        case 'eq': return x === y ? 1n : 0n
        case 'ne': return x !== y ? 1n : 0n
        case 'abs': return abs(x)
        case 'min': return x < y ? x : y
        case 'max': return x > y ? x : y
        case 'gcd': { let p = abs(x), q = abs(y); while (q) [p, q] = [q, p % q]; return p }
        case 'digitsum': return sg(x, [...str(x)].reduce((t, c) => t + Number(c), 0))
        case 'reverse': return sg(x, [...str(x)].reverse().join(''))
        case 'digits': return BigInt(str(x).length)
        case 'concat': return sg(x, str(x) + str(y))
        case 'asc': return sg(x, [...str(x)].sort().join(''))
        case 'desc': return x === 0n ? 0n : sg(x, [...str(x)].sort().reverse().join('').padEnd(v.D, '0'))
        case 'band': return x & y
        case 'bor': return x | y
        case 'bxor': return x ^ y
        case 'shl': return y >= 0n ? x << y : x >> -y
        case 'shr': return y >= 0n ? x >> y : x << -y
      }
      throw new Error('ref: ' + n.f)
    }
  }
}
function wrap(x, P, negative) { const p = BigInt(P); return Number(negative ? x % p : ((x % p) + p) % p) }

const cases = [
  ['b', 'a+b'], ['a^2+b', 'a*b-7'], ['a^b', 'b-a'], ['a^b+1', '(a+b) mod 7'], ['-a^2', 'a mod (b-5)'],
  ['2a(b+1)', 'a^3^2 - b'], ['a^(b-5)', 'a mod 0 + b'], ['99999999999999999999*a+b', 'a - -b'], ['(a^b) mod 13', 'b^a*a^b'],
  ['a / (b-3)', '(a-7) div 3 + b/0'], ['if(a mod 2 = 0, a/2, 3a+1)', 'if(a < b, a^b, b - a)'], ['a <= b', '(a != b) + (a >= 5) + (a > b) + (a == 3)'],
  ['abs(a-b)', 'min(a, b, 5) + max(a-b, b-a, 3)'], ['gcd(a, b)', 'gcd(a-5, b, 12)'], ['digitsum(a*b-30)', 'reverse(a*b-200) + digits(a-b)'],
  ['concat(a, b)', 'concat(a-5, b-5, 7)'], ['desc(a*b-9) - asc(a*b-9)', 'asc(a-50)+desc(b)'], ['a xor b', '(a-5) and (b-3) or 8'],
  ['a << 2', '(a*b-40) >> (b-3)'], ['a xor (a << 13)', 'a < 5 and b > 2 or a = b'], ['99999999999999999999 / (a+1)', 'digitsum(a^b)'],
  ['if(a < 3, a^b + b, a)', 'reverse(a^b) mod 97'], ['(a^b) xor b', 'gcd(a^b, 12) + (a^b >> 3)'], ['a << b', 'concat(a^b, b)'],
]
let tiersSeen = new Set()
for (const negative of [false, true]) for (const digits of [1, 2]) for (const f of cases) {
  const c = compile(f, { dims: 2, digits, negative })
  c.tiers.forEach((t) => tiersSeen.add(t))
  const asts = f.map((s) => parse(s, 2))
  const N = c.R ** 2
  const next = new Uint32Array(N)
  // fill in two uneven chunks to exercise the decode path
  c.fill(next, 0, 37); c.fill(next, 37, N)
  const s = new Float64Array(2), o = new Float64Array(2)
  for (let i = 0; i < N; i++) {
    const v = [Math.floor(i / c.R) + c.lo, (i % c.R) + c.lo]
    v.D = digits
    const want = asts.map((a) => wrap(ev(a, v), c.P, negative))
    const wi = (want[0] - c.lo) * c.R + (want[1] - c.lo)
    assert.equal(next[i], wi, `${f} neg=${negative} d=${digits} at ${v}: tiers ${c.tiers}`)
    s[0] = v[0]; s[1] = v[1]; c.step(s, o)
    assert.deepEqual([o[0], o[1]], want)
  }
}
assert.deepEqual([...tiersSeen].sort(), ['bigint', 'float', 'modular'])
for (const bad of ['a+c', 'a+', '(a', 'abs()', 'abs(a,b)', 'if(a,b)', 'a ! b', 'min(a)', 'gcd a', 'a,b']) assert.throws(() => parse(bad, 2), bad)

// --- the digit-append Fibonacci from the README: cycles 1123581347, 1459 and 00 ---
assert.deepEqual(build({ dims: 2, digits: 1, negative: false, formulas: ['if(a+b<10, b, 1)', '(a+b) mod 10'] }).stats.census, [[1, 1], [3, 1], [8, 1]])
// --- Kaprekar: every 4-digit number with two distinct digits reaches 6174 ---
{
  const k = build({ dims: 1, digits: 4, negative: false, formulas: ['desc(a) - asc(a)'] })
  assert.deepEqual(k.stats.census, [[1, 2]]) // fixed points 0 and 6174
}
// --- Collatz on 1..999 wraps, but must at least evaluate and enumerate ---
assert.equal(build({ dims: 1, digits: 3, negative: false, formulas: ['if(a mod 2 = 0, a/2, 3a+1)'] }).stats.totalStates, '1000')

// --- Fibonacci mod 10: known cycle structure 60,20,12,4,3,1 ---
let g = build({ dims: 2, digits: 1, negative: false, formulas: ['b', 'a+b'] })
assert.deepEqual(g.stats.census, [[1, 1], [3, 1], [4, 1], [12, 1], [20, 1], [60, 1]])
assert.equal(g.stats.leaves, 0)

function crossings(m, succ, L) {
  // brute-force segment intersection count over the drawn polylines (small graphs only)
  const E = []
  for (let v = 0; v < m; v++) for (let i = L.edgeOff[v]; i + 1 < L.edgeOff[v + 1]; i++)
    E.push([v, succ[v], L.edgePts[2 * i], L.edgePts[2 * i + 1], L.edgePts[2 * i + 2], L.edgePts[2 * i + 3]])
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
  let n = 0
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const p = E[i], q = E[j]
    if (p[0] === q[0] || p[0] === q[1] || p[1] === q[0] || p[1] === q[1]) continue
    if (o(p[2], p[3], p[4], p[5], q[2], q[3]) * o(p[2], p[3], p[4], p[5], q[4], q[5]) < 0 &&
        o(q[2], q[3], q[4], q[5], p[2], p[3]) * o(q[2], q[3], q[4], q[5], p[4], p[5]) < 0) n++
  }
  return n
}
function minDist(m, L) {
  let best = Infinity
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) best = Math.min(best, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]))
  return best
}

for (const [formulas, opt] of [
  [['b', 'a^2+b'], { digits: 1 }], [['a*b+1', 'a+b'], { digits: 1, negative: true }], [['b', 'a*b+a'], { digits: 2 }],
  [['a^2+1'], { dims: 1, digits: 3 }], [['a^2+b', 'b+1'], { digits: 1, negative: true }], [['a*b', 'a+b'], { digits: 1, negative: true }], [['a^3+7'], { dims: 1, digits: 3 }], [['0', '0'], { digits: 1 }], [['a', 'b'], { digits: 1 }], [['a*a', 'b*b*b'], { digits: 2 }],
]) {
  const p = { dims: 2, digits: 1, negative: false, formulas, ...opt }
  const t0 = performance.now()
  g = build(p)
  const t1 = performance.now()
  const L = layout(g.m, g.succ)
  const t2 = performance.now()
  for (let i = 0; i < g.m; i++) assert.ok(Number.isFinite(L.x[i]) && Number.isFinite(L.y[i]), 'finite coords')
  assert.equal(new Set(L.order).size, g.m)
  const x = g.m <= 1500 ? crossings(g.m, g.succ, L) : 'n/a'
  const md = g.m <= 4000 ? minDist(g.m, L).toFixed(2) : 'n/a'
  console.log(`${formulas.join(' | ')} ${JSON.stringify(opt)}: m=${g.m} comps=${L.compR.length} span=${(L.bounds[2] - L.bounds[0]).toFixed(0)} cycles=${g.stats.cycles} crossings=${x} minDist=${md} build=${(t1 - t0).toFixed(1)}ms layout=${(t2 - t1).toFixed(1)}ms`)
}

// --- big spaces ---
for (const p of [
  { dims: 2, digits: 3, negative: false, formulas: ['b', 'a^2+b'] },
  { dims: 2, digits: 3, negative: true, formulas: ['b', 'a*b+1'] },
  { dims: 3, digits: 2, negative: true, formulas: ['b', 'c', 'a*b-c'] },
  { dims: 2, digits: 3, negative: false, formulas: ['b', 'a+b'] },
  { dims: 4, digits: 4, negative: true, formulas: ['b', 'c', 'd', 'a*b+c^2-d'] },
  { dims: 3, digits: 6, negative: false, formulas: ['b', 'c', 'a^b+c'] },
  { dims: 2, digits: 5, negative: false, formulas: ['a*0', 'b mod 3'] },
]) {
  const t0 = performance.now()
  g = build(p)
  const t1 = performance.now()
  const L = layout(g.m, g.succ)
  const t2 = performance.now()
  assert.ok(g.m <= BUDGET)
  for (let i = 0; i < g.m; i++) assert.ok(Number.isFinite(L.x[i]) && Number.isFinite(L.y[i]))
  const s = g.stats
  console.log(`${p.formulas.join(' | ')} d=${p.digits} neg=${p.negative}: N=${s.totalStates} ${s.mode} m=${g.m} comps=${L.compR.length} cycles=${s.cycles ?? '?'} longest=${s.longest ?? s.lambda} tiers=${s.tiers} build=${(t1 - t0).toFixed(0)}ms layout=${(t2 - t1).toFixed(0)}ms span=${(L.bounds[2] - L.bounds[0]).toFixed(0)}`)
}
console.log('ok')
