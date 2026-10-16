// Recursive-descent parser for integer formulas. Loosest to tightest:
//   or     := xor ('or' xor)*                      bitwise (logical on 0/1)
//   xor    := and ('xor' and)*
//   and    := cmp ('and' cmp)*
//   cmp    := shift (('<'|'<='|'>'|'>='|'='|'!=') shift)*      yields 1 or 0
//   shift  := sum (('<<'|'>>') sum)*
//   sum    := term (('+'|'-') term)*
//   term   := unary (('*'|'/'|'div'|'mod'|'%'|<implicit>) unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?                    right-associative, tighter than unary minus
//   atom   := number | variable | '(' or ')' | name '(' or (',' or)* ')'
// AST nodes: {t:'num',v,raw} {t:'var',i} {t:'unit',u} (i, j, k = 1, 2, 3) {t:'neg',x} {t:'add'|'sub'|'mul'|'mod'|'pow',l,r}
//            {t:'call',f,args}  for everything else (see FN in compile.js)

export const VAR_NAMES = ['a', 'b', 'c', 'd', 'e']

// name -> [min args, max args]
export const FUNCTIONS = {
  if: [3, 3], abs: [1, 1], min: [2, 9], max: [2, 9], gcd: [2, 9],
  digitsum: [1, 1], reverse: [1, 1], digits: [1, 1], concat: [2, 9], asc: [1, 1], desc: [1, 1],
  digitprod: [1, 1], digit: [2, 2], lcm: [2, 9], sign: [1, 1], isqrt: [1, 1], log2: [1, 1],
  sigma: [1, 1], phi: [1, 1], spf: [1, 1], isprime: [1, 1],
  conj: [1, 1], re: [1, 1], im: [1, 1], norm: [1, 1], // complex / quaternion only
}
const WORD_OPS = ['mod', 'div', 'xor', 'and', 'or']
const WORDS = [...Object.keys(FUNCTIONS), ...WORD_OPS].sort((p, q) => q.length - p.length)
const SYMBOLS = ['+', '-', '*', '/', '^', '(', ')', ',', '<', '<=', '>', '>=', '=', '!=', '<<', '>>']
const ALIAS = { '%': 'mod', '−': '-', '×': '*', '·': '*', '÷': '/', '==': '=', '≠': '!=', '≤': '<=', '≥': '>=' }
const CMP = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '=': 'eq', '!=': 'ne' }

/** `units` lists the imaginary units allowed as constants: '' (integers), 'i' (complex) or 'ijk' (quaternions). */
export function parse(src, dims, units = '') {
  const toks = []
  const re = /\s*(?:(\d+)|((?:log2|[A-Za-z])+)|(<<|>>|<=|>=|==|!=|.))/giy
  let m
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) toks.push({ k: 'num', s: m[1] })
    else if (m[2] !== undefined) {
      // a run of letters is keywords (longest match first) and single-letter variables, e.g. "ab" = a*b
      let w = m[2].toLowerCase()
      while (w.length) {
        const kw = WORDS.find((k) => w.startsWith(k))
        if (kw) { toks.push(WORD_OPS.includes(kw) ? { k: 'op', s: kw } : { k: 'fn', s: kw }); w = w.slice(kw.length); continue }
        if (units.includes(w[0])) { toks.push({ k: 'unit', u: 'ijk'.indexOf(w[0]) + 1 }); w = w.slice(1); continue }
        const i = VAR_NAMES.indexOf(w[0])
        if (i < 0 || i >= dims) throw new Error(`Unknown symbol "${w[0]}" (variables: ${VAR_NAMES.slice(0, dims).join(', ')})`)
        toks.push({ k: 'var', i })
        w = w.slice(1)
      }
    } else if (m[3] !== undefined) {
      const c = ALIAS[m[3]] ?? m[3]
      if (!SYMBOLS.includes(c) && c !== 'mod') throw new Error(`Unexpected "${m[3]}"`)
      toks.push({ k: 'op', s: c })
    }
    if (re.lastIndex >= src.length) break
  }
  if (!toks.length) throw new Error('Empty formula')

  let p = 0
  const peek = (s) => p < toks.length && toks[p].k === 'op' && toks[p].s === s
  const eat = (s) => (peek(s) ? (p++, true) : false)
  const startsAtom = () => p < toks.length && (toks[p].k !== 'op' || toks[p].s === '(')
  const call = (f, ...args) => ({ t: 'call', f, args })
  const leftAssoc = (next, ops) => () => {
    let l = next()
    for (;;) {
      const op = Object.keys(ops).find(peek)
      if (!op) return l
      p++
      l = ops[op](l, next())
    }
  }
  const bin = (t) => (l, r) => ({ t, l, r })
  const fn = (f) => (l, r) => call(f, l, r)

  function term() {
    let l = unary()
    for (;;) {
      if (eat('*')) l = { t: 'mul', l, r: unary() }
      else if (eat('mod')) l = { t: 'mod', l, r: unary() }
      else if (eat('/') || eat('div')) l = call('div', l, unary())
      else if (startsAtom()) l = { t: 'mul', l, r: power() }
      else return l
    }
  }
  const sum = leftAssoc(term, { '+': bin('add'), '-': bin('sub') })
  const shift = leftAssoc(sum, { '<<': fn('shl'), '>>': fn('shr') })
  const cmp = leftAssoc(shift, Object.fromEntries(Object.entries(CMP).map(([s, f]) => [s, fn(f)])))
  const and = leftAssoc(cmp, { and: fn('band') })
  const xor = leftAssoc(and, { xor: fn('bxor') })
  const expr = leftAssoc(xor, { or: fn('bor') })

  function unary() {
    if (eat('-')) return { t: 'neg', x: unary() }
    return power()
  }
  function power() {
    const base = atom()
    if (eat('^')) return { t: 'pow', l: base, r: unary() }
    return base
  }
  function atom() {
    const tk = toks[p]
    if (!tk) throw new Error('Unexpected end of formula')
    if (tk.k === 'num') { p++; return { t: 'num', v: Number(tk.s), raw: tk.s.replace(/^0+(?=\d)/, '') } }
    if (tk.k === 'var') { p++; return { t: 'var', i: tk.i } }
    if (tk.k === 'unit') { p++; return { t: 'unit', u: tk.u } }
    if (tk.k === 'fn') {
      p++
      if (!eat('(')) throw new Error(`Expected "(" after ${tk.s}`)
      const args = [expr()]
      while (eat(',')) args.push(expr())
      if (!eat(')')) throw new Error(`Missing ")" after ${tk.s}(…`)
      const [lo, hi] = FUNCTIONS[tk.s]
      if (args.length < lo || args.length > hi) throw new Error(`${tk.s}() takes ${lo === hi ? lo : `${lo} or more`} argument${lo === 1 && hi === 1 ? '' : 's'}`)
      if (tk.s === 'if' || args.length <= 2) return call(tk.s, ...args)
      return args.reduce((l, r) => call(tk.s, l, r)) // min/max/gcd/lcm/concat fold left
    }
    if (tk.s === '(') {
      p++
      const e = expr()
      if (!eat(')')) throw new Error('Missing ")"')
      return e
    }
    throw new Error(`Unexpected "${tk.s}"`)
  }

  const ast = expr()
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].s ?? (toks[p].u ? 'ijk'[toks[p].u - 1] : VAR_NAMES[toks[p].i])}"`)
  return ast
}
