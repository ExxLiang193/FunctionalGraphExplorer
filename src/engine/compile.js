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
    case 'var': a = lo; b = hi; n.ok = true; break
    case 'neg': bounds(n.x, lo, hi, D); a = -n.x.hi; b = -n.x.lo; n.ok = n.x.ok; break
    case 'call': {
      n.args.forEach((x) => bounds(x, lo, hi, D))
      n.ok = n.args.every((x) => x.ok)
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
  if (n.ok) return `fm(${genFloat(n, D)})`
  const g = (x) => genMod(x, P, D)
  switch (n.t) {
    case 'num': return `${Number(BigInt(n.raw) % BigInt(P))}`
    case 'neg': return `((${P}-${g(n.x)})%${P})`
    case 'add': return `((${g(n.l)}+${g(n.r)})%${P})`
    case 'sub': return `((${g(n.l)}-${g(n.r)}+${P})%${P})`
    case 'mul': return `((${g(n.l)}*${g(n.r)})%${P})`
    case 'pow':
      if (n.r.ok && n.r.lo >= 0) return `powm(${g(n.l)},${genFloat(n.r, D)})`
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
const HELPERS = {
  ipow, emod, bmod, bpow, fdiv, bdiv, gcd, bgcd, babs, bmin, bmax,
  digitsum, reverse, ndigits, concat, asc, desc, bdigitsum, breverse, bndigits, bconcat, basc, bdesc,
  band, bor, bxor, shl, bshl,
}

/**
 * @returns {{ tiers: string[], fill(next, from, to), step(src, dst) }}
 *   fill writes next[i] for state indices [from, to); step maps one coordinate tuple.
 *   State index = sum_i (v_i - lo) * R^(n-1-i).
 */
export function compile(formulas, { dims, digits, negative }) {
  const P = 10 ** digits
  const lo = negative ? -(P - 1) : 0
  const hi = P - 1
  const R = hi - lo + 1
  const tiers = []
  const used = new Set()
  const exprs = formulas.map((src, i) => {
    let ast
    try { ast = parse(src, dims) } catch (e) { e.formulaIndex = i; throw e }
    bounds(ast, lo, hi, digits)
    if (ast.ok) { tiers.push('float'); return negative ? `tm(${genFloat(ast, digits)})` : `fm(${genFloat(ast, digits)})` }
    if (!negative) {
      try { const s = genMod(ast, P, digits); tiers.push('modular'); return s } catch (e) { if (!(e instanceof NeedBig)) throw e }
    }
    tiers.push('bigint')
    const b = genBig(ast, used, digits)
    return negative ? `Number((${b})%${P}n)` : `Number(bmod(${b},${P}n))`
  })

  const idx = Array.from({ length: dims }, (_, i) => i)
  const bigDecl = [...used].map((i) => `const B${i}=BigInt(v${i});`).join('')
  const results = exprs.map((e, i) => `const r${i}=${e};`).join('')
  const pre = `
    function fm(x){x%=${P};return x<0?x+${P}:x}
    function tm(x){return x%${P}}
    function powm(b,e){let r=1;while(e>0){if(e%2===1)r=r*b%${P};e=Math.floor(e/2);b=b*b%${P}}return r}`

  // Horner-encoded successor index; coordinates advance by odometer (no div/mod in the hot loop).
  const horner = idx.reduce((acc, i) => (i === 0 ? `(r0-(${lo}))` : `(${acc}*${R}+(r${i}-(${lo})))`), '')
  // odometer: the last variable spins fastest, matching the index encoding
  let odo = ''
  for (let i = 0; i < dims; i++) odo = i === 0 ? `++v0;` : `if(++v${i}>${hi}){v${i}=${lo};${odo}}`
  const decode = idx.map((i) => `let v${i}=${lo}+Math.floor(from/${R ** (dims - 1 - i)})%${R};`).join('')
  const fillSrc = `${pre}
    return function fill(next,from,to){${decode}
      for(let i=from;i<to;i++){${bigDecl}${results}next[i]=${horner};${odo}}
    }`
  const stepSrc = `${pre}
    return function step(s,o){${idx.map((i) => `const v${i}=s[${i}];`).join('')}${bigDecl}${results}${idx.map((i) => `o[${i}]=r${i}+0;`).join('')}}`

  const mk = (src) => new Function(...Object.keys(HELPERS), src)(...Object.values(HELPERS))
  return { tiers, fill: mk(fillSrc), step: mk(stepSrc), P, lo, hi, R }
}
