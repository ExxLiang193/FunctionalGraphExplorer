// Compiles parsed formulas into specialised JS via `new Function`.
//
// Every formula is evaluated EXACTLY over the integers and then wrapped into the
// finite range. Each formula independently picks the cheapest tier that is
// provably exact, using interval analysis over the variable range:
//   1. float  – every intermediate fits in 2^53, plain float64 arithmetic
//   2. modular – unsigned range only: +,-,*,^ are ring homomorphisms onto Z/P,
//      so intermediates are reduced mod P as we go (a^b never materialises)
//   3. bigint – arbitrary precision fallback
import { parse } from './parser.js'

const SAFE = Number.MAX_SAFE_INTEGER

function bounds(n, lo, hi) {
  let a, b
  switch (n.t) {
    case 'num': a = b = n.v; n.ok = true; break
    case 'var': a = lo; b = hi; n.ok = true; break
    case 'neg': bounds(n.x, lo, hi); a = -n.x.hi; b = -n.x.lo; n.ok = n.x.ok; break
    default: {
      const l = n.l, r = n.r
      bounds(l, lo, hi); bounds(r, lo, hi)
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

function genFloat(n) {
  switch (n.t) {
    case 'num': return `${n.v}`
    case 'var': return `v${n.i}`
    case 'neg': return `(-${genFloat(n.x)})`
    case 'mod': return `emod(${genFloat(n.l)},${genFloat(n.r)})`
    case 'pow': return `ipow(${genFloat(n.l)},${genFloat(n.r)})`
    default: return `(${genFloat(n.l)}${BIN[n.t]}${genFloat(n.r)})`
  }
}

class NeedBig extends Error {}

// Emits an expression congruent to n (mod P) with value in [0, P). P <= 1e6 so products stay exact.
function genMod(n, P) {
  if (n.ok) return `fm(${genFloat(n)})`
  switch (n.t) {
    case 'num': return `${Number(BigInt(n.raw) % BigInt(P))}`
    case 'neg': return `((${P}-${genMod(n.x, P)})%${P})`
    case 'add': return `((${genMod(n.l, P)}+${genMod(n.r, P)})%${P})`
    case 'sub': return `((${genMod(n.l, P)}-${genMod(n.r, P)}+${P})%${P})`
    case 'mul': return `((${genMod(n.l, P)}*${genMod(n.r, P)})%${P})`
    case 'pow':
      if (n.r.ok && n.r.lo >= 0) return `powm(${genMod(n.l, P)},${genFloat(n.r)})`
      throw new NeedBig()
    default: throw new NeedBig()
  }
}

function genBig(n, used) {
  switch (n.t) {
    case 'num': return `${n.raw}n`
    case 'var': used.add(n.i); return `B${n.i}`
    case 'neg': return `(-${genBig(n.x, used)})`
    case 'mod': return `bmod(${genBig(n.l, used)},${genBig(n.r, used)})`
    case 'pow': return `bpow(${genBig(n.l, used)},${genBig(n.r, used)})`
    default: return `(${genBig(n.l, used)}${BIN[n.t]}${genBig(n.r, used)})`
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
    bounds(ast, lo, hi)
    if (ast.ok) { tiers.push('float'); return negative ? `tm(${genFloat(ast)})` : `fm(${genFloat(ast)})` }
    if (!negative) {
      try { const s = genMod(ast, P); tiers.push('modular'); return s } catch (e) { if (!(e instanceof NeedBig)) throw e }
    }
    tiers.push('bigint')
    const b = genBig(ast, used)
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

  const mk = (src) => new Function('ipow', 'emod', 'bmod', 'bpow', src)(ipow, emod, bmod, bpow)
  return { tiers, fill: mk(fillSrc), step: mk(stepSrc), P, lo, hi, R }
}
