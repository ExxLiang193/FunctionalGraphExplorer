// Every example configuration from the README, in README order (test/readme.test.mjs keeps the two in sync).
// Omitted fields default to: integers, no custom modulus, no per-variable moduli, negative off, sample limit 10,000.
const key = (f) => f.join('|').replace(/\s+/g, '').toLowerCase()

/**
 * The example whose formulas equal `formulas` (ignoring spaces and case), or null.
 * `exact` says whether its digits/modulus and negative setting match too; an exact match wins.
 */
export function findExample({ dims, digits, modulus, moduli, field = 'int', negative, formulas }) {
  const k = key(formulas)
  let loose = null
  for (const ex of EXAMPLES) {
    if (ex.dims !== dims || (ex.field ?? 'int') !== field || key(ex.f) !== k) continue
    const sameMods = Array.from({ length: dims }, (_, j) => (ex.moduli?.[j] ?? null) === (moduli?.[j] ?? null)).every(Boolean)
    const same = sameMods && !!ex.negative === negative && (ex.modulus ?? null) === modulus && (modulus !== null || ex.digits === digits)
    if (same) return { example: ex, exact: true }
    loose ??= ex
  }
  return loose && { example: loose, exact: false }
}

export const EXAMPLES = [
  { name: "Fibonacci", dims: 2, digits: 1, f: ['b', 'a + b'] },
  { name: "Fibonacci mod 100", dims: 2, digits: 2, f: ['b', 'a + b'] },
  { name: "Pell", dims: 2, digits: 2, f: ['b', 'a + 2b'] },
  { name: "Tribonacci", dims: 3, digits: 1, f: ['b', 'c', 'a + b + c'] },
  { name: "Arnold's cat map", dims: 2, digits: 2, f: ['a + b', 'a + 2b'] },
  { name: "Period six", dims: 2, digits: 2, f: ['b', 'b - a'] },
  { name: "Quarter turn", dims: 2, digits: 1, negative: true, f: ['b', '-a'] },
  { name: "Swap", dims: 2, digits: 1, f: ['b', 'a'] },
  { name: "Hénon", dims: 2, digits: 2, f: ['b + 1 - a^2', 'a'] },
  { name: "Step by 8", dims: 1, digits: 3, f: ['a + 8'] },
  { name: "Full-period generator", dims: 1, digits: 3, f: ['21a + 1'] },
  { name: "Broken generator", dims: 1, digits: 3, f: ['6a + 1'] },
  { name: "Times 3", dims: 1, digits: 3, f: ['3a'] },
  { name: "Riffle shuffle", dims: 1, digits: 3, f: ['a/2 + 500(a mod 2)'] },
  { name: "Digit rotation", dims: 1, digits: 3, f: ['(a mod 100)*10 + a/100'] },
  { name: "Doubling", dims: 1, digits: 3, f: ['2a'] },
  { name: "Times 5", dims: 1, digits: 3, f: ['5a'] },
  { name: "Halving", dims: 1, digits: 3, f: ['a / 2'] },
  { name: "Squaring", dims: 1, digits: 3, f: ['a^2'] },
  { name: "Cubing", dims: 1, digits: 3, f: ['a^3'] },
  { name: "Pollard's rho", dims: 1, digits: 4, f: ['a^2 + 1'] },
  { name: "Lucas–Lehmer", dims: 1, digits: 3, f: ['a^2 - 2'] },
  { name: "Triangular", dims: 1, digits: 3, f: ['a(a + 1)/2'] },
  { name: "Logistic", dims: 1, digits: 3, f: ['a(999 - a)'] },
  { name: "Exponential", dims: 1, digits: 3, f: ['2^a'] },
  { name: "Self power", dims: 1, digits: 4, f: ['a^a'] },
  { name: "Power tower", dims: 2, digits: 2, f: ['a^b', 'b'] },
  { name: "Quadratic pair", dims: 2, digits: 2, f: ['b', 'a^2 + b'] },
  { name: "Product and sum", dims: 2, digits: 2, f: ['a*b', 'a + b'] },
  { name: "Averaging", dims: 2, digits: 2, f: ['(a + b)/2', 'a'] },
  { name: "Collatz", dims: 1, digits: 3, f: ['if(a mod 2 = 0, a/2, 3a + 1)'] },
  { name: "Collatz shortcut", dims: 1, digits: 3, f: ['if(a mod 2 = 0, a/2, (3a + 1)/2)'] },
  { name: "5n + 1", dims: 1, digits: 3, f: ['if(a mod 2 = 0, a/2, 5a + 1)'] },
  { name: "Negative Collatz", dims: 1, digits: 3, negative: true, f: ['if(a mod 2 = 0, a/2, 3a + 1)'] },
  { name: "Tent map", dims: 1, digits: 3, f: ['if(a < 500, 2a, 2(999 - a))'] },
  { name: "Gingerbreadman", dims: 2, digits: 2, negative: true, f: ['1 - b + abs(a)', 'a'] },
  { name: "Subtractive Euclid", dims: 2, digits: 2, f: ['abs(a - b)', 'min(a, b)'] },
  { name: "Euclid", dims: 2, digits: 2, f: ['b', 'a mod b'] },
  { name: "Sort", dims: 2, digits: 2, f: ['min(a, b)', 'max(a, b)'] },
  { name: "Ducci (4)", dims: 4, digits: 1, f: ['abs(a - b)', 'abs(b - c)', 'abs(c - d)', 'abs(d - a)'] },
  { name: "Ducci (3)", dims: 3, digits: 1, f: ['abs(a - b)', 'abs(b - c)', 'abs(c - a)'] },
  { name: "Digit append", dims: 2, digits: 1, f: ['if(a + b < 10, b, 1)', '(a + b) mod 10'] },
  { name: "Digit append, 2-digit blocks", dims: 2, digits: 2, f: ['a*10^digits(a+b) + concat(b, a+b)/100', 'concat(b, a+b)'] },
  { name: "Kaprekar (4)", dims: 1, digits: 4, f: ['desc(a) - asc(a)'] },
  { name: "Kaprekar (3)", dims: 1, digits: 3, f: ['desc(a) - asc(a)'] },
  { name: "Happy numbers", dims: 1, digits: 3, f: ['(a/100)^2 + (a/10 mod 10)^2 + (a mod 10)^2'] },
  { name: "Digit cubes", dims: 1, digits: 4, f: ['(a/1000)^3 + (a/100 mod 10)^3 + (a/10 mod 10)^3 + (a mod 10)^3'] },
  { name: "Self numbers", dims: 1, digits: 3, f: ['a + digitsum(a)'] },
  { name: "Reverse and add", dims: 1, digits: 4, f: ['a + reverse(a)'] },
  { name: "Xorshift", dims: 1, digits: 4, f: ['a xor (a << 3) xor (a >> 2)'] },
  { name: "Xor Fibonacci", dims: 2, digits: 2, f: ['b', 'a xor b'] },
  { name: "Kaprekar (5)", dims: 1, digits: 5, limit: 100000, f: ['desc(a) - asc(a)'] },
  { name: "Collatz to 99,999", dims: 1, digits: 5, limit: 100000, f: ['if(a mod 2 = 0, a/2, 3a + 1)'] },
  { name: "Pollard's rho (5)", dims: 1, digits: 5, limit: 100000, f: ['a^2 + 1'] },
  { name: "Happy numbers (5)", dims: 1, digits: 5, limit: 100000, f: ['(a/10000)^2 + (a/1000 mod 10)^2 + (a/100 mod 10)^2 + (a/10 mod 10)^2 + (a mod 10)^2'] },
  { name: "Self numbers (5)", dims: 1, digits: 5, limit: 100000, f: ['a + digitsum(a)'] },
  { name: "Reverse and add (5)", dims: 1, digits: 5, limit: 100000, f: ['a + reverse(a)'] },
  { name: "Xorshift (5)", dims: 1, digits: 5, limit: 100000, f: ['a xor (a << 3) xor (a >> 2)'] },
  { name: "Gingerbreadman, whole", dims: 2, digits: 2, negative: true, limit: 50000, f: ['1 - b + abs(a)', 'a'] },
  { name: "Signed Fibonacci", dims: 2, digits: 2, negative: true, limit: 50000, f: ['b', 'a + b'] },
  { name: "Quarter turn (2)", dims: 2, digits: 2, negative: true, limit: 50000, f: ['b', '-a'] },
  { name: "Negative Collatz (4)", dims: 1, digits: 4, negative: true, limit: 50000, f: ['if(a mod 2 = 0, a/2, 3a + 1)'] },
  { name: "Digit append, 3-digit blocks", dims: 2, digits: 3, limit: 100000, f: ['a*10^digits(a+b) + concat(b, a+b)/1000', 'concat(b, a+b)'] },
  { name: "Quadratic pair (3)", dims: 2, digits: 3, limit: 100000, f: ['b', 'a^2 + b'] },
  { name: "Tribonacci mod 100", dims: 3, digits: 2, limit: 100000, f: ['b', 'c', 'a + b + c'] },
  { name: "Fibonacci mod 1000", dims: 2, digits: 3, limit: 100000, f: ['b', 'a + b'] },
  { name: "Ducci (5)", dims: 5, digits: 1, limit: 100000, f: ['abs(a - b)', 'abs(b - c)', 'abs(c - d)', 'abs(d - e)', 'abs(e - a)'] },
  { name: "Aliquot", dims: 1, digits: 4, f: ['sigma(a) - a'] },
  { name: "Totient", dims: 1, digits: 4, f: ['phi(a)'] },
  { name: "Prime peeling", dims: 1, digits: 4, f: ['a / spf(a)'] },
  { name: "Juggler", dims: 1, digits: 4, f: ['if(a mod 2 = 0, isqrt(a), isqrt(a^3))'] },
  { name: "Multiplicative persistence", dims: 1, digits: 4, f: ['digitprod(a)'] },
  { name: "Root-paced growth", dims: 1, digits: 4, f: ['a + isqrt(a)'] },
  { name: "Rho over a prime field", dims: 1, digits: 3, modulus: 997, f: ['a^2 + 1'] },
  { name: "12-bit xorshift", dims: 1, digits: 4, modulus: 4096, f: ['a xor (a << 3) xor (a >> 2)'] },
  { name: "Fibonacci over a prime field", dims: 2, digits: 2, modulus: 97, f: ['b', 'a + b'] },
  { name: "lcm and gcd", dims: 2, digits: 2, f: ['lcm(a, b)', 'gcd(a, b)'] },
  { name: "Complex squaring", field: 'complex', dims: 1, digits: 2, modulus: 31, f: ['a^2'] },
  { name: "Julia-style", field: 'complex', dims: 1, digits: 2, modulus: 31, f: ['a^2 + i'] },
  { name: "Gaussian Fibonacci", field: 'complex', dims: 2, digits: 1, f: ['b', 'a + i*b'] },
  { name: "Complex Hénon", field: 'complex', dims: 2, digits: 1, f: ['b + 1 - a^2', 'a'] },
  { name: "Quaternion square", field: 'quat', dims: 1, digits: 1, f: ['a^2 + j'] },
  { name: "Quaternion sandwich", field: 'quat', dims: 1, digits: 1, f: ['i*a*j'] },
  { name: "Commutator", field: 'quat', dims: 1, digits: 1, f: ['a*i - i*a'] },
  { name: "Quaternion cube", field: 'quat', dims: 1, digits: 1, modulus: 7, f: ['a^3 + 1'] },
  { name: "Mixed-moduli Fibonacci", dims: 2, digits: 2, moduli: [100, 99], f: ['b', 'a + b'] },
  { name: "Mixed-moduli quadratic", dims: 2, digits: 2, moduli: [64, 81], f: ['b', 'a^2 + b'] },
]
