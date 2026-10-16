// Compiles parsed formulas into specialised JS via `new Function`.
//
// Every formula is evaluated EXACTLY over the integers and then wrapped into the
// finite range. Each formula independently picks the cheapest tier that is
// provably exact, using interval analysis over the variable range:
//   1. float  – every intermediate fits in 2^53, plain float64 arithmetic
//   2. modular – unsigned range only: +,-,*,^ are ring homomorphisms onto Z/P,
//      so intermediates are reduced mod P as we go (a^b never materialises);
//      any other operation must itself be float-exact to sit inside such a formula
//   3. bigint – arbitrary precision fallback
import { parse } from './parser.js'

const SAFE = Number.MAX_SAFE_INTEGER

const mag = (n) => Math.max(Math.abs(n.lo), Math.abs(n.hi))
const signed = (B, n) => [n.lo < 0 ? -B : 0, n.hi > 0 ? B : 0]
const bitwise = (l, r) => { const B = 2 * Math.max(mag(l), mag(r)) + 1; return [l.lo < 0 || r.lo < 0 ? -B : 0, B] }
const shifted = (l, e) => { const B = mag(l) * 2 ** Math.max(0, e); return [l.lo < 0 ? -Math.max(B, 1) : 0, B] }
const bool = () => [0, 1]
const call = (name) => (...args) => `${name}(${args.join(',')})`
const cmpOp = (op) => ({
  bounds: bool,
  float: (l, r) => `(${l}${op === '=' ? '===' : op === '!=' ? '!==' : op}${r}?1:0)`,
  big: (l, r) => `(${l}${op === '=' ? '===' : op === '!=' ? '!==' : op}${r}?1n:0n)`,
})

// Everything beyond + - * mod ^: result interval for the tier analysis, plus float64 and BigInt code.
const FN = {
  div: { // floored; x div 0 = 0, so x = (x div y)*y + (x mod y) always holds
    bounds: (l, r) => (l.lo >= 0 && r.lo >= 0 ? [0, l.hi] : [-mag(l), mag(l)]),
    float: call('fdiv'), big: call('bdiv'),
  },
  lt: cmpOp('<'), le: cmpOp('<='), gt: cmpOp('>'), ge: cmpOp('>='), eq: cmpOp('='), ne: cmpOp('!='),
  if: { // lazy: only the chosen branch is evaluated
    bounds: (c, x, y) => [Math.min(x.lo, y.lo), Math.max(x.hi, y.hi)],
    float: (c, x, y) => `(${c}!==0?${x}:${y})`, big: (c, x, y) => `(${c}!==0n?${x}:${y})`,
  },
  abs: { bounds: (x) => [x.lo <= 0 && x.hi >= 0 ? 0 : Math.min(Math.abs(x.lo), Math.abs(x.hi)), mag(x)], float: call('Math.abs'), big: call('babs') },
  min: { bounds: (l, r) => [Math.min(l.lo, r.lo), Math.min(l.hi, r.hi)], float: call('Math.min'), big: (l, r) => `bmin(${l},${r})` },
  max: { bounds: (l, r) => [Math.max(l.lo, r.lo), Math.max(l.hi, r.hi)], float: call('Math.max'), big: (l, r) => `bmax(${l},${r})` },
  gcd: { bounds: (l, r) => [0, Math.max(mag(l), mag(r))], float: call('gcd'), big: call('bgcd') },
  // digit functions act on |x| and keep the sign of x
  digitsum: { bounds: (x) => signed(mag(x), x), float: call('digitsum'), big: call('bdigitsum') },
  reverse: { bounds: (x) => signed(10 * mag(x), x), float: call('reverse'), big: call('breverse') },
  digits: { bounds: (x) => [1, Math.floor(Math.log10(Math.max(mag(x), 1))) + 2], float: call('ndigits'), big: call('bndigits') },
  concat: {
    bounds: (l, r) => { const B = mag(l) * 10 * Math.max(mag(r), 1) + mag(r); return [l.lo < 0 ? -B : 0, B] },
    float: call('concat'), big: call('bconcat'),
  },
  asc: { bounds: (x) => signed(mag(x), x), float: call('asc'), big: call('basc') },
  desc: { // zero-padded to the configured width, so desc(a) - asc(a) is Kaprekar's routine
    bounds: (x, D) => signed(Math.max(10 * mag(x), 10 ** D), x),
    float: (x, D) => `desc(${x},${D})`, big: (x, D) => `bdesc(${x},${D})`, ctx: true,
  },
  digitprod: { bounds: (x) => signed(mag(x), x), float: call('digitprod'), big: call('bdigitprod') },
  digit: { bounds: () => [0, 9], float: call('digit'), big: call('bdigit') }, // digit(x, i): i = 0 is the units digit
  lcm: { bounds: (l, r) => [0, mag(l) * mag(r)], float: call('lcm'), big: call('blcm') },
  sign: {
    bounds: (x) => [x.lo < 0 ? -1 : x.lo > 0 ? 1 : 0, x.hi > 0 ? 1 : x.hi < 0 ? -1 : 0],
    float: call('Math.sign'), big: (x) => `BigInt(bcmp0(${x}))`,
  },
  isqrt: { bounds: (x) => signed(Math.ceil(Math.sqrt(mag(x))), x), float: call('isqrt'), big: call('bisqrt') }, // keeps the sign of x
  log2: { bounds: (x) => [0, Math.ceil(Math.log2(mag(x) + 1))], float: call('flog2'), big: call('blog2') }, // floor(log2 |x|), 0 at 0
  // number-theoretic functions act on |x|
  sigma: { bounds: (x) => [0, mag(x) * (Math.log(mag(x) + 1) + 1)], float: call('sigma'), big: (x) => `BigInt(sigma(small(${x})))` },
  phi: { bounds: (x) => [0, mag(x)], float: call('phi'), big: (x) => `BigInt(phi(small(${x})))` },
  spf: { bounds: (x) => [0, mag(x)], float: call('spf'), big: (x) => `BigInt(spf(small(${x})))` },
  isprime: { bounds: bool, float: call('isprime'), big: (x) => `BigInt(isprime(small(${x})))` },
  // bitwise operators use two's complement for negatives; a negative shift count reverses direction
  band: { bounds: bitwise, float: call('band'), big: (l, r) => `(${l}&${r})` },
  bor: { bounds: bitwise, float: call('bor'), big: (l, r) => `(${l}|${r})` },
  bxor: { bounds: bitwise, float: call('bxor'), big: (l, r) => `(${l}^${r})` },
  shl: { bounds: (l, r) => shifted(l, r.hi), float: call('shl'), big: call('bshl') },
  shr: { bounds: (l, r) => shifted(l, -r.lo), float: (l, r) => `shl(${l},-(${r}))`, big: (l, r) => `bshl(${l},-(${r}))` },
}

function bounds(n, lo, hi, D) {
  let a, b
  switch (n.t) {
    case 'num': a = b = n.v; n.ok = true; break
    case 'var': a = lo[n.i]; b = hi[n.i]; n.ok = true; break
    case 'neg': bounds(n.x, lo, hi, D); a = -n.x.hi; b = -n.x.lo; n.ok = n.x.ok; break
    case 'call': {
      n.args.forEach((x) => bounds(x, lo, hi, D))
      n.ok = n.args.every((x) => x.ok)
      if (!FN[n.f]) throw new Error(`${n.f}() needs complex or quaternion mode`)
      ;[a, b] = FN[n.f].ctx ? FN[n.f].bounds(...n.args, D) : FN[n.f].bounds(...n.args)
      break
    }
    default: {
      const l = n.l, r = n.r
      bounds(l, lo, hi, D); bounds(r, lo, hi, D)
      n.ok = l.ok && r.ok
      if (n.t === 'add') { a = l.lo + r.lo; b = l.hi + r.hi }
      else if (n.t === 'sub') { a = l.lo - r.hi; b = l.hi - r.lo }
      else if (n.t === 'mul') {
        const c = [l.lo * r.lo, l.lo * r.hi, l.hi * r.lo, l.hi * r.hi]
        a = Math.min(...c); b = Math.max(...c)
      } else if (n.t === 'mod') {
        // floored modulo: result takes the divisor's sign; x mod 0 = x
        const D = Math.max(Math.abs(r.lo), Math.abs(r.hi))
        a = r.lo < 0 ? -(D - 1) : 0
        b = r.hi > 0 ? D - 1 : 0
        if (r.lo <= 0 && r.hi >= 0) { a = Math.min(a, l.lo); b = Math.max(b, l.hi) }
      } else {
        const B = Math.max(Math.abs(l.lo), Math.abs(l.hi))
        const mag = r.hi <= 0 || B <= 1 ? 1 : Math.pow(B, r.hi) * (1 + 1e-9)
        a = l.lo < 0 ? -mag : 0; b = mag
      }
    }
  }
  if (Number.isNaN(a) || Number.isNaN(b)) { a = -Infinity; b = Infinity }
  n.lo = a; n.hi = b
  n.ok = n.ok && Math.max(Math.abs(a), Math.abs(b)) <= SAFE
}

const BIN = { add: '+', sub: '-', mul: '*' }

function genFloat(n, D) {
  switch (n.t) {
    case 'call': { const a = n.args.map((x) => genFloat(x, D)); return FN[n.f].ctx ? FN[n.f].float(...a, D) : FN[n.f].float(...a) }
    case 'num': return `${n.v}`
    case 'var': return `v${n.i}`
    case 'neg': return `(-${genFloat(n.x, D)})`
    case 'mod': return `emod(${genFloat(n.l, D)},${genFloat(n.r, D)})`
    case 'pow': return `ipow(${genFloat(n.l, D)},${genFloat(n.r, D)})`
    default: return `(${genFloat(n.l, D)}${BIN[n.t]}${genFloat(n.r, D)})`
  }
}

class NeedBig extends Error {}

// Emits an expression congruent to n (mod P) with value in [0, P). P <= 1e6 so products stay exact.
function genMod(n, P, D) {
  if (n.ok) return `fm(${genFloat(n, D)},${P})`
  const g = (x) => genMod(x, P, D)
  switch (n.t) {
    case 'num': return `${Number(BigInt(n.raw) % BigInt(P))}`
    case 'neg': return `((${P}-${g(n.x)})%${P})`
    case 'add': return `((${g(n.l)}+${g(n.r)})%${P})`
    case 'sub': return `((${g(n.l)}-${g(n.r)}+${P})%${P})`
    case 'mul': return `((${g(n.l)}*${g(n.r)})%${P})`
    case 'pow':
      if (n.r.ok && n.r.lo >= 0) return `powm(${g(n.l)},${genFloat(n.r, D)},${P})`
      throw new NeedBig()
    case 'call':
      if (n.f === 'if' && n.args[0].ok) return `(${genFloat(n.args[0], D)}!==0?${g(n.args[1])}:${g(n.args[2])})`
      throw new NeedBig()
    default: throw new NeedBig()
  }
}

function genBig(n, used, D) {
  switch (n.t) {
    case 'call': { const a = n.args.map((x) => genBig(x, used, D)); return FN[n.f].ctx ? FN[n.f].big(...a, D) : FN[n.f].big(...a) }
    case 'num': return `${n.raw}n`
    case 'var': used.add(n.i); return `B${n.i}`
    case 'neg': return `(-${genBig(n.x, used, D)})`
    case 'mod': return `bmod(${genBig(n.l, used, D)},${genBig(n.r, used, D)})`
    case 'pow': return `bpow(${genBig(n.l, used, D)},${genBig(n.r, used, D)})`
    default: return `(${genBig(n.l, used, D)}${BIN[n.t]}${genBig(n.r, used, D)})`
  }
}

// ---- runtime helpers shared by generated code ----
function ipow(b, e) {
  if (e < 0) return b === 1 ? 1 : b === -1 ? (e % 2 ? -1 : 1) : 0
  let r = 1
  for (;;) {
    if (e % 2 === 1) r *= b
    e = Math.floor(e / 2)
    if (e === 0) return r
    b *= b
  }
}
function emod(x, y) {
  if (y === 0) return x
  const r = x % y
  return r !== 0 && (r < 0) !== (y < 0) ? r + y : r
}
function bmod(x, y) {
  if (y === 0n) return x
  const r = x % y
  return r !== 0n && (r < 0n) !== (y < 0n) ? r + y : r
}
function bpow(b, e) {
  if (e < 0n) return b === 1n ? 1n : b === -1n ? (e % 2n ? -1n : 1n) : 0n
  if (b === 0n || b === 1n) return e === 0n ? 1n : b
  if (b === -1n) return e % 2n ? -1n : 1n
  if (Number(e) * Math.log2(Math.abs(Number(b))) > 4e6) throw new Error('Intermediate value too large to evaluate exactly')
  return b ** e
}

function fdiv(x, y) { return y === 0 ? 0 : Math.floor(x / y) }
function bdiv(x, y) {
  if (y === 0n) return 0n
  const q = x / y
  return x % y !== 0n && (x < 0n) !== (y < 0n) ? q - 1n : q
}
function gcd(x, y) { x = Math.abs(x); y = Math.abs(y); while (y) { const t = x % y; x = y; y = t } return x }
function bgcd(x, y) { x = babs(x); y = babs(y); while (y) { const t = x % y; x = y; y = t } return x }
const babs = (x) => (x < 0n ? -x : x)
const bmin = (x, y) => (x < y ? x : y)
const bmax = (x, y) => (x > y ? x : y)

function digitsum(x) { let m = Math.abs(x), s = 0; while (m > 0) { s += m % 10; m = Math.floor(m / 10) } return x < 0 ? -s : s }
function reverse(x) { let m = Math.abs(x), r = 0; while (m > 0) { r = r * 10 + (m % 10); m = Math.floor(m / 10) } return x < 0 ? -r : r }
function ndigits(x) { let m = Math.abs(x), n = 1; while (m >= 10) { m = Math.floor(m / 10); n++ } return n }
const P10 = Array.from({ length: 23 }, (_, i) => Number(`1e${i}`)) // exact powers of ten
function concat(x, y) { y = Math.abs(y); const r = Math.abs(x) * P10[ndigits(y)] + y; return x < 0 ? -r : r }
const COUNT = new Uint8Array(10)
function tally(m) { COUNT.fill(0); let n = 0; do { COUNT[m % 10]++; m = Math.floor(m / 10); n++ } while (m > 0); return n }
function asc(x) {
  tally(Math.abs(x))
  let r = 0
  for (let d = 1; d < 10; d++) for (let i = COUNT[d]; i > 0; i--) r = r * 10 + d
  return x < 0 ? -r : r
}
function desc(x, D) {
  if (x === 0) return 0
  const n = tally(Math.abs(x))
  let r = 0
  for (let d = 9; d >= 0; d--) for (let i = COUNT[d]; i > 0; i--) r = r * 10 + d
  if (n < D) r *= P10[D - n]
  return x < 0 ? -r : r
}
const bstr = (x) => babs(x).toString()
const bsign = (x, s) => { const r = BigInt(s); return x < 0n ? -r : r }
function bdigitsum(x) { let s = 0; for (const c of bstr(x)) s += c.charCodeAt(0) - 48; return bsign(x, s) }
const breverse = (x) => bsign(x, [...bstr(x)].reverse().join(''))
const bndigits = (x) => BigInt(bstr(x).length)
const bconcat = (x, y) => bsign(x, bstr(x) + bstr(y))
const basc = (x) => bsign(x, [...bstr(x)].sort().join(''))
const bdesc = (x, D) => (x === 0n ? 0n : bsign(x, [...bstr(x)].sort().reverse().join('').padEnd(D, '0')))

// int32 operands take the native path; anything wider goes through BigInt (same two's-complement semantics)
const i32 = (x, y) => (x | 0) === x && (y | 0) === y
function band(x, y) { return i32(x, y) ? x & y : Number(BigInt(x) & BigInt(y)) }
function bor(x, y) { return i32(x, y) ? x | y : Number(BigInt(x) | BigInt(y)) }
function bxor(x, y) { return i32(x, y) ? x ^ y : Number(BigInt(x) ^ BigInt(y)) }
function shl(x, n) { return n >= 0 ? x * 2 ** n : Math.floor(x / 2 ** -n) }
function bshl(x, n) {
  if (n > 4000000n) { if (x === 0n) return 0n; throw new Error('Intermediate value too large to evaluate exactly') }
  return n < -4000000n ? (x < 0n ? -1n : 0n) : x << n
}
function digitprod(x) { let m = Math.abs(x), r = m > 0 ? 1 : 0; while (m > 0) { r *= m % 10; m = Math.floor(m / 10) } return x < 0 ? -r : r }
function digit(x, i) { return i < 0 || i > 22 ? 0 : Math.floor(Math.abs(x) / P10[i]) % 10 }
function bdigitprod(x) { let r = 1n; for (const c of bstr(x)) r *= BigInt(c.charCodeAt(0) - 48); return x < 0n ? -r : r }
function bdigit(x, i) { const s = bstr(x); return i < 0n || i >= BigInt(s.length) ? 0n : BigInt(s.charCodeAt(s.length - 1 - Number(i)) - 48) }
function lcm(x, y) { const g = gcd(x, y); return g === 0 ? 0 : Math.abs((x / g) * y) }
function blcm(x, y) { const g = bgcd(x, y); return g === 0n ? 0n : babs((x / g) * y) }
const bcmp0 = (x) => (x > 0n ? 1 : x < 0n ? -1 : 0)
function isqrt(x) {
  const m = Math.abs(x)
  let r = Math.floor(Math.sqrt(m))
  while (r * r > m) r--
  while ((r + 1) * (r + 1) <= m) r++
  return x < 0 ? -r : r
}
function bisqrt(x) {
  const m = babs(x)
  if (m < 2n) return x
  let r = 1n << BigInt((m.toString(2).length + 1) >> 1) // Newton from above converges monotonically
  for (;;) { const n = (r + m / r) >> 1n; if (n >= r) break; r = n }
  return x < 0n ? -r : r
}
function flog2(x) { let m = Math.abs(x), n = 0; while (m >= 2) { m = Math.floor(m / 2); n++ } return n }
const blog2 = (x) => (x === 0n ? 0n : BigInt(babs(x).toString(2).length - 1))

// Factorisation: a smallest-prime-factor sieve (built on first use) covers arguments up to SIEVE;
// larger ones are trial-divided down into its range.
const SIEVE = 1 << 21
const FACTOR_MAX = 1e12
let SPF = null
function sieve() {
  SPF = new Uint32Array(SIEVE + 1)
  for (let i = 2; i <= SIEVE; i++) {
    if (SPF[i]) continue
    for (let j = i; j <= SIEVE; j += i) if (!SPF[j]) SPF[j] = i
  }
}
// Calls f(p, e) for every prime power p^e exactly dividing n >= 2.
function factor(n, f) {
  if (n > FACTOR_MAX) throw new Error('sigma/phi/spf/isprime: argument too large to factor')
  if (!SPF) sieve()
  for (let p = 2; n > SIEVE && p * p <= n; p += p === 2 ? 1 : 2) {
    if (n % p) continue
    let e = 0
    do { n /= p; e++ } while (n % p === 0)
    f(p, e)
  }
  if (n > SIEVE) { f(n, 1); return } // what is left is prime
  while (n > 1) {
    const p = SPF[n]
    let e = 0
    do { n /= p; e++ } while (n % p === 0)
    f(p, e)
  }
}
function sigma(x) {
  const n = Math.abs(x)
  if (n < 2) return n
  let s = 1
  factor(n, (p, e) => { let t = 1, q = 1; for (let i = 0; i < e; i++) { q *= p; t += q } s *= t })
  return s
}
function phi(x) {
  const n = Math.abs(x)
  if (n < 2) return n
  let r = n
  factor(n, (p) => { r = (r / p) * (p - 1) })
  return r
}
function spf(x) {
  const n = Math.abs(x)
  if (n < 2) return n
  if (n <= SIEVE) { if (!SPF) sieve(); return SPF[n] }
  let least = 0
  factor(n, (p) => { if (!least) least = p })
  return least
}
function isprime(x) { const n = Math.abs(x); return n > 1 && spf(n) === n ? 1 : 0 }
function small(x) {
  const m = babs(x)
  if (m > BigInt(FACTOR_MAX)) throw new Error('sigma/phi/spf/isprime: argument too large to factor')
  return Number(m)
}
const HELPERS = {
  digitprod, digit, bdigitprod, bdigit, lcm, blcm, bcmp0, isqrt, bisqrt, flog2, blog2, sigma, phi, spf, isprime, small,
  ipow, emod, bmod, bpow, fdiv, bdiv, gcd, bgcd, babs, bmin, bmax,
  digitsum, reverse, ndigits, concat, asc, desc, bdigitsum, breverse, bndigits, bconcat, basc, bdesc,
  band, bor, bxor, shl, bshl,
}

// ---------- complex numbers and quaternions ----------
// A value is C integer components (C = 2: x + yi, C = 4: w + xi + yj + zk). Only ring operations are
// allowed, so with an unsigned range every component can be reduced mod P as we go.
const MUL = {
  // each output component is a signed sum of products a[p] * b[q]
  2: [[[1, 0, 0], [-1, 1, 1]], [[1, 0, 1], [1, 1, 0]]],
  4: [
    [[1, 0, 0], [-1, 1, 1], [-1, 2, 2], [-1, 3, 3]],
    [[1, 0, 1], [1, 1, 0], [1, 2, 3], [-1, 3, 2]],
    [[1, 0, 2], [-1, 1, 3], [1, 2, 0], [1, 3, 1]],
    [[1, 0, 3], [1, 1, 2], [-1, 2, 1], [1, 3, 0]],
  ],
}
const FIELD_FNS = ['conj', 're', 'im', 'norm']

// Largest |component| any intermediate can reach; throws on operations that have no meaning here.
function fieldBound(n, C, mag, name) {
  const b = (x) => fieldBound(x, C, mag, name)
  let r
  switch (n.t) {
    case 'num': r = n.v; break
    case 'unit': r = 1; break
    case 'var': r = mag[n.i]; break
    case 'neg': r = b(n.x); break
    case 'add': case 'sub': r = b(n.l) + b(n.r); break
    case 'mul': r = C * b(n.l) * b(n.r); break
    case 'pow': {
      if (n.r.t !== 'num') throw new Error(`Exponents must be whole numbers like a^2 for ${name}`)
      let base = b(n.l), acc = 1, worst = base
      for (let e = n.r.v; e > 0; e = Math.floor(e / 2)) {
        if (e % 2) { acc = C * acc * base; worst = Math.max(worst, acc) }
        if (e > 1) { base = C * base * base; worst = Math.max(worst, base) }
      }
      r = worst
      break
    }
    case 'call':
      if (!FIELD_FNS.includes(n.f)) throw new Error(`${n.f}() is not available for ${name}`)
      r = n.f === 'norm' ? C * b(n.args[0]) ** 2 : b(n.args[0])
      break
    default: throw new Error(`"${n.t === 'mod' ? 'mod' : n.t}" is not available for ${name}`)
  }
  n.B = r
  return Math.max(r, ...(n.args || [n.l, n.r, n.x].filter(Boolean)).map((x) => x.W ?? 0), (n.W = r))
}

/** Emits statements computing formula `ast` as C components; returns { stmts, outs }. */
function genField(ast, C, tier, P, Pv, used, tag) {
  const stmts = []
  let t = 0
  const Z = tier === 'bigint' ? '0n' : '0'
  const red = (x) => (tier === 'modular' ? `fm(${x},${P})` : x)
  const emit = (x) => { const v = `t${tag}_${t++}`; stmts.push(`const ${v}=${red(x)};`); return v }
  const lit = (n) => (tier === 'bigint' ? `${n.raw}n` : tier === 'modular' ? `${Number(BigInt(n.raw) % BigInt(P))}` : `${n.v}`)
  const comp = (j, c) => {
    const k = j * C + c
    if (tier === 'bigint') { used.add(k); return `B${k}` }
    return tier === 'modular' && Pv[j] > P ? `(v${k}%${P})` : `v${k}`
  }
  const one = (u) => Array.from({ length: C }, (_, c) => (c === u ? (tier === 'bigint' ? '1n' : '1') : Z))
  const mul = (a, b) => MUL[C].map((terms) => emit(terms.map(([sg, p, q], i) => `${sg < 0 ? '-' : i ? '+' : ''}${a[p]}*${b[q]}`).join('')))
  const g = (n) => {
    switch (n.t) {
      case 'num': return [lit(n), ...Array(C - 1).fill(Z)]
      case 'unit': return one(n.u)
      case 'var': return Array.from({ length: C }, (_, c) => comp(n.i, c))
      case 'neg': return g(n.x).map((x) => emit(`-(${x})`))
      case 'add': { const a = g(n.l), b = g(n.r); return a.map((x, c) => emit(`${x}+${b[c]}`)) }
      case 'sub': { const a = g(n.l), b = g(n.r); return a.map((x, c) => emit(`${x}-(${b[c]})`)) }
      case 'mul': return mul(g(n.l), g(n.r))
      case 'pow': {
        let base = g(n.l), acc = null
        for (let e = n.r.v; e > 0; e = Math.floor(e / 2)) {
          if (e % 2) acc = acc ? mul(acc, base) : base
          if (e > 1) base = mul(base, base)
        }
        return acc ?? one(0)
      }
      case 'call': {
        const x = g(n.args[0])
        if (n.f === 'conj') return x.map((v, c) => (c ? emit(`-(${v})`) : v))
        if (n.f === 're') return [x[0], ...Array(C - 1).fill(Z)]
        if (n.f === 'im') return C === 2 ? [x[1], Z] : [Z, ...x.slice(1)]
        return [emit(x.map((v) => `${v}*${v}`).join('+')), ...Array(C - 1).fill(Z)] // norm
      }
    }
  }
  return { stmts, outs: g(ast) }
}

/**
 * `modulus` (optional) replaces 10^digits as the wrap-around modulus; `moduli[j]` overrides it for variable j.
 * `field` is 'int', 'complex' or 'quat'. Slots are the integer components of a state (dims * C of them).
 * @returns {{ tiers: string[], fill(next, from, to), step(src, dst) }}
 *   fill writes next[i] for state indices [from, to); step maps one coordinate tuple.
 *   State index = sum_i (v_i - lo) * R^(n-1-i).
 */
export function compile(formulas, { dims, digits, negative, modulus, moduli, field = 'int' }) {
  // Each variable lives in [0, P) (or (-P, P) with negatives). P is 10^digits, or the custom modulus,
  // or that variable's own entry in `moduli`. Complex/quaternion variables use it for every component.
  const C = field === 'complex' ? 2 : field === 'quat' ? 4 : 1
  const name = C === 2 ? 'complex numbers' : 'quaternions'
  const units = C === 2 ? 'i' : C === 4 ? 'ijk' : ''
  const base = modulus ?? 10 ** digits
  const Pv = Array.from({ length: dims }, (_, j) => moduli?.[j] ?? base)
  for (const P of Pv) if (!Number.isInteger(P) || P < 2 || P > 9e7) throw new Error('Modulus must be a whole number from 2 to 90,000,000')
  // slots: one per integer component of the state, variable-major
  const K = dims * C
  const P = Array.from({ length: K }, (_, k) => Pv[Math.floor(k / C)])
  const lo = P.map((p) => (negative ? -(p - 1) : 0))
  const hi = P.map((p) => p - 1)
  const R = P.map((p, k) => hi[k] - lo[k] + 1)
  const tiers = []
  const used = new Set()
  const results = []
  formulas.forEach((src, j) => {
    const Pj = Pv[j], D = String(Pj - 1).length // D: width used by desc() padding
    let ast
    try {
      ast = parse(src, dims, units)
      if (C > 1) {
        const worst = fieldBound(ast, C, Pv.map((p) => p - 1), name)
        const tier = !negative ? 'modular' : worst <= SAFE ? 'float' : 'bigint'
        tiers.push(tier)
        const { stmts, outs } = genField(ast, C, tier, Pj, Pv, used, j)
        results.push(stmts.join(''))
        outs.forEach((x, c) => results.push(`const r${j * C + c}=${tier === 'modular' ? x : tier === 'float' ? `tm(${x},${Pj})` : `Number((${x})%${Pj}n)`};`))
        return
      }
      bounds(ast, lo, hi, D)
    } catch (e) { e.formulaIndex = j; throw e }
    let expr
    if (ast.ok) { tiers.push('float'); expr = negative ? `tm(${genFloat(ast, D)},${Pj})` : `fm(${genFloat(ast, D)},${Pj})` }
    if (!expr && !negative) {
      try { expr = genMod(ast, Pj, D); tiers.push('modular') } catch (e) { if (!(e instanceof NeedBig)) throw e }
    }
    if (!expr) {
      tiers.push('bigint')
      const b = genBig(ast, used, D)
      expr = negative ? `Number((${b})%${Pj}n)` : `Number(bmod(${b},${Pj}n))`
    }
    results.push(`const r${j}=${expr};`)
  })

  const idx = Array.from({ length: K }, (_, k) => k)
  const bigDecl = [...used].map((k) => `const B${k}=BigInt(v${k});`).join('')
  const body = results.join('')
  const pre = `
    function fm(x,P){x%=P;return x<0?x+P:x}
    function tm(x,P){return x%P}
    function powm(b,e,P){let r=1;while(e>0){if(e%2===1)r=r*b%P;e=Math.floor(e/2);b=b*b%P}return r}`

  // Mixed-radix successor index (Horner); coordinates advance by odometer (no div/mod in the hot loop).
  const horner = idx.reduce((acc, k) => (k === 0 ? `(r0-(${lo[0]}))` : `(${acc}*${R[k]}+(r${k}-(${lo[k]})))`), '')
  // odometer: the last slot spins fastest, matching the index encoding
  let odo = ''
  for (let k = 0; k < K; k++) odo = k === 0 ? `++v0;` : `if(++v${k}>${hi[k]}){v${k}=${lo[k]};${odo}}`
  const stride = idx.map((k) => R.slice(k + 1).reduce((a, b) => a * b, 1))
  const decode = idx.map((k) => `let v${k}=${lo[k]}+Math.floor(from/${stride[k]})%${R[k]};`).join('')
  const fillSrc = `${pre}
    return function fill(next,from,to){${decode}
      for(let i=from;i<to;i++){${bigDecl}${body}next[i]=${horner};${odo}}
    }`
  const stepSrc = `${pre}
    return function step(s,o){${idx.map((k) => `const v${k}=s[${k}];`).join('')}${bigDecl}${body}${idx.map((k) => `o[${k}]=r${k}+0;`).join('')}}`

  const mk = (src) => new Function(...Object.keys(HELPERS), src)(...Object.values(HELPERS))
  return { tiers, fill: mk(fillSrc), step: mk(stepSrc), K, C, P, lo, hi, R }
}
