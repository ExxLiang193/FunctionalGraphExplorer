// Recursive-descent parser for integer formulas.
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | 'mod' | '%' | <implicit>) unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?          (right-associative, binds tighter than unary minus)
//   atom   := number | variable | '(' expr ')'
// AST nodes: {t:'num',v,raw} {t:'var',i} {t:'neg',x} {t:'add'|'sub'|'mul'|'mod'|'pow',l,r}

export const VAR_NAMES = ['a', 'b', 'c', 'd']

export function parse(src, dims) {
  const toks = []
  const re = /\s*(?:(\d+)|([A-Za-z]+)|(.))/gy
  let m
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) toks.push({ k: 'num', s: m[1] })
    else if (m[2] !== undefined) {
      // split runs like "ab" into implicit products, but keep the `mod` keyword whole
      let w = m[2].toLowerCase()
      while (w.length) {
        if (w.startsWith('mod')) { toks.push({ k: 'op', s: 'mod' }); w = w.slice(3); continue }
        const i = VAR_NAMES.indexOf(w[0])
        if (i < 0 || i >= dims) {
          const avail = VAR_NAMES.slice(0, dims).join(', ')
          throw new Error(`Unknown symbol "${w[0]}" (variables: ${avail})`)
        }
        toks.push({ k: 'var', i })
        w = w.slice(1)
      }
    } else if (m[3] !== undefined) {
      const c = m[3] === '%' ? 'mod' : m[3] === '−' ? '-' : m[3] === '×' || m[3] === '·' ? '*' : m[3]
      if (!['+', '-', '*', '^', '(', ')', 'mod'].includes(c)) throw new Error(`Unexpected "${m[3]}"`)
      toks.push({ k: 'op', s: c })
    }
    if (re.lastIndex >= src.length) break
  }
  if (!toks.length) throw new Error('Empty formula')

  let p = 0
  const peek = (s) => p < toks.length && toks[p].k === 'op' && toks[p].s === s
  const startsAtom = () => p < toks.length && (toks[p].k !== 'op' || toks[p].s === '(')

  function expr() {
    let l = term()
    for (;;) {
      if (peek('+')) { p++; l = { t: 'add', l, r: term() } }
      else if (peek('-')) { p++; l = { t: 'sub', l, r: term() } }
      else return l
    }
  }
  function term() {
    let l = unary()
    for (;;) {
      if (peek('*')) { p++; l = { t: 'mul', l, r: unary() } }
      else if (peek('mod')) { p++; l = { t: 'mod', l, r: unary() } }
      else if (startsAtom()) l = { t: 'mul', l, r: power() }
      else return l
    }
  }
  function unary() {
    if (peek('-')) { p++; return { t: 'neg', x: unary() } }
    return power()
  }
  function power() {
    const base = atom()
    if (peek('^')) { p++; return { t: 'pow', l: base, r: unary() } }
    return base
  }
  function atom() {
    const tk = toks[p]
    if (!tk) throw new Error('Unexpected end of formula')
    if (tk.k === 'num') { p++; return { t: 'num', v: Number(tk.s), raw: tk.s.replace(/^0+(?=\d)/, '') } }
    if (tk.k === 'var') { p++; return { t: 'var', i: tk.i } }
    if (tk.s === '(') {
      p++
      const e = expr()
      if (!peek(')')) throw new Error('Missing ")"')
      p++
      return e
    }
    throw new Error(`Unexpected "${tk.s}"`)
  }

  const ast = expr()
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].s ?? VAR_NAMES[toks[p].i]}"`)
  return ast
}
