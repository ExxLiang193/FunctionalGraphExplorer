// Random configuration generator: a space within the state limit plus one formula per variable,
// each at most MAX_SYMBOLS symbols (variables, numbers, operators and function names).
import { VAR_NAMES } from './parser.js'

export const MAX_SYMBOLS = 9

// precedence levels, matching the parser
const ATOM = 9, POW = 8, MUL = 6, ADD = 5, SHIFT = 4, CMP = 3, AND = 2, XOR = 1, OR = 0

export const countSymbols = (src) => (src.match(/\d+|[a-z]+|<<|>>|<=|>=|!=|[-+*/^<>=]/gi) || [])
  .reduce((n, t) => n + (/^[a-e]+$/i.test(t) ? t.length : 1), 0)

export function randomConfig(maxStates, rnd = Math.random) {
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const weighted = (table) => {
    let r = rnd() * table.reduce((s, t) => s + t[0], 0)
    for (const t of table) if ((r -= t[0]) < 0) return t[1]
    return table[0][1]
  }

  const spaces = []
  for (let dims = 1; dims <= VAR_NAMES.length; dims++)
    for (let digits = 1; digits <= 5; digits++)
      for (const negative of [false, true])
        if ((negative ? 2 * 10 ** digits - 1 : 10 ** digits) ** dims <= maxStates) spaces.push({ dims, digits, negative })
  const space = pick(spaces)
  const vars = VAR_NAMES.slice(0, space.dims)

  // An expression is { s: source, p: precedence, n: symbols }.
  const wrap = (e, min) => (e.p >= min ? e.s : `(${e.s})`)
  const leaf = () => (rnd() < 0.78 ? { s: pick(vars), p: ATOM, n: 1 } : { s: String(int(1, 9)), p: ATOM, n: 1 })
  const variable = () => ({ s: pick(vars), p: ATOM, n: 1 })
  const infix = (op, p, l, r) => ({ s: `${wrap(l, p)} ${op} ${wrap(r, p + 1)}`, p, n: l.n + r.n + 1 })
  const fn = (name, ...args) => ({ s: `${name}(${args.map((a) => a.s).join(', ')})`, p: ATOM, n: 1 + args.reduce((s, a) => s + a.n, 0) })
  const two = (budget) => { const l = gen(int(1, budget - 1)); return [l, gen(budget - l.n)] }

  function gen(budget) {
    if (budget < 2) return leaf()
    const kinds = [[2, 'leaf']]
    if (budget >= 2) kinds.push([2, 'fn1'])
    if (budget >= 3) kinds.push([6, 'add'], [5, 'sub'], [5, 'mul'], [3, 'pow'], [2, 'div'], [2, 'mod'], [2, 'bit'], [1.5, 'shift'], [1.5, 'fn2'])
    if (budget >= 4) kinds.push([1.5, 'absdiff'])
    if (budget >= 6) kinds.push([2, 'if'])
    switch (weighted(kinds)) {
      case 'leaf': return leaf()
      case 'fn1': return fn(pick(['digitsum', 'reverse', 'asc', 'desc']), gen(budget - 1))
      case 'add': return infix('+', ADD, ...two(budget - 1))
      case 'sub': return infix('-', ADD, ...two(budget - 1))
      case 'mul': return infix('*', MUL, ...two(budget - 1))
      // exponents stay small constants so a formula can never need astronomically large intermediates
      case 'pow': { const b = gen(budget - 2); return { s: `${wrap(b, POW + 1)}^${int(2, 3)}`, p: POW, n: b.n + 2 } }
      case 'div': { const l = gen(budget - 2); return { s: `${wrap(l, MUL)} / ${int(2, 9)}`, p: MUL, n: l.n + 2 } }
      case 'mod': { const l = gen(budget - 2); return { s: `${wrap(l, MUL)} mod ${pick([2, 3, 5, 7, 9, 11, 16])}`, p: MUL, n: l.n + 2 } }
      case 'bit': { const [op, p] = pick([['xor', XOR], ['and', AND], ['or', OR]]); return infix(op, p, ...two(budget - 1)) }
      case 'shift': { const l = gen(budget - 2); return { s: `${wrap(l, SHIFT)} ${pick(['<<', '>>'])} ${int(1, 3)}`, p: SHIFT, n: l.n + 2 } }
      case 'fn2': return fn(pick(['min', 'max', 'gcd']), ...two(budget - 1))
      case 'absdiff': return fn('abs', infix('-', ADD, ...two(budget - 2)))
      case 'if': {
        const test = infix(pick(['<', '>', '=']), CMP, variable(), rnd() < 0.5 ? variable() : { s: String(int(1, 9)), p: ATOM, n: 1 })
        const x = gen(int(1, budget - 5))
        return fn('if', test, x, gen(budget - 4 - x.n))
      }
    }
  }
  // A formula must depend on at least one variable and be more than a bare variable copy of itself.
  const formula = (self) => {
    for (;;) {
      const e = gen(int(3, MAX_SYMBOLS))
      if (/[a-e]/.test(e.s.replace(/[a-z]{2,}/g, '')) && e.s !== self) return e.s
    }
  }

  // Half the time build a recurrence (shift register): every variable takes the next one's value
  // and the last gets the new term, which must then involve the oldest variable.
  let formulas
  if (space.dims > 1 && rnd() < 0.5) {
    let last
    do last = formula(null); while (!new RegExp(`(^|[^a-z])${vars[0]}([^a-z]|$)`).test(last))
    formulas = [...vars.slice(1), last]
  } else formulas = vars.map((v) => formula(v))
  return { ...space, formulas }
}
