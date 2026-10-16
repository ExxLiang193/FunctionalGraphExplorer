# Functional Graph Explorer

**Live app: https://exxliang193.github.io/FunctionalGraphExplorer/**

![(a, b, c, d, e) → (b, c, d, e, a^3 − (a^3 >> 5)), ℤ⁵, 1 digit](examples/graph_b_c_d_e_a%5E3-%28a%5E3--5%29.jpg)

![(a, b, c, d, e) → (b, c, d, e, a^4 − (a^3 >> 6)), ℤ⁵, 1 digit](examples/graph_b_c_d_e_a%5E4-%28a%5E3--6%29.jpg)

![(a, b) → (b, a^2 + b), ℤ², 2 digits](examples/graph_b_a%5E2%2Bb.jpg)

Visualizes the directed graph of an integer map `(a, b, …) → (A, B, …)` on a finite space: every state has one successor, so each component is a cycle with trees feeding into it.

Enter formulas using the variables `a b c d e` and the operations below, choose the dimension (ℤ to ℤ⁵), the number of digits, and whether negatives are allowed, then press **Submit**. Results wrap to the chosen digit count, or to any modulus you type in the "or modulus" box (a prime such as 997, a power of two such as 4096, …). The small `mod` box after each formula gives that variable its own modulus.

The ℤ / ℂ / ℍ switch picks the number system. In ℂ each variable is a complex number x + yi (up to two variables); in ℍ there is one quaternion w + xi + yj + zk. Every component wraps at the variable's modulus, so useful moduli there are small (2 to 31). The Examples menu next to Submit loads any configuration listed below. The dice button fills in a random space and random formulas (at most 9 symbols each, at most 1,000,000 states).

## Operations

| | |
|---|---|
| Arithmetic | `+ - * ^`, `/` or `div` (rounds down), `mod` |
| Tests (give 1 or 0) | `< <= > >= = !=`, `if(test, x, y)` |
| Numeric | `abs(x)`, `sign(x)`, `min(x, y, …)`, `max(…)`, `gcd(…)`, `lcm(…)`, `isqrt(x)` (square root, rounded down), `log2(x)` (rounded down) |
| Digits | `digitsum(x)`, `reverse(x)`, `digits(x)` (count), `concat(x, y)`, `asc(x)`, `desc(x)` (sorted digits; `desc` pads to the digit setting), `digitprod(x)`, `digit(x, i)` (i = 0 is the units digit) |
| Number theory | `sigma(x)` (sum of divisors), `phi(x)` (Euler's totient), `spf(x)` (smallest prime factor), `isprime(x)` |
| Bitwise | `and`, `or`, `xor`, `<<`, `>>` |

| Complex and quaternion modes | `+ - *`, whole-number powers `^n`, the units `i` (ℂ) or `i j k` (ℍ), `conj(x)`, `re(x)`, `im(x)`, `norm(x)`. Quaternion multiplication is not commutative: `i*a` and `a*i` differ. |
Examples: Collatz `if(a mod 2 = 0, a/2, 3a + 1)`, Kaprekar `desc(a) - asc(a)`, the digit-append Fibonacci `(if(a+b < 10, b, 1), (a+b) mod 10)`.

Press **⌥S** (Option+S, or the Save button) to save the current view as a PNG, with the formula above the graph and the legend below it.

## Reading the graph

- Hue = length of the cycle a basin drains into; brightness fades with distance from the cycle.
- Layout is planar: cycles on circles, trees on rings around them.
- Spaces over the sample limit (10k, 50k or 100k states) show a sample of that size grown breadth-first from a random cycle. Spaces over 1,000,000 states cannot be submitted.

## Examples to try

Set the space, digits and negatives as listed, type the formulas, and press Submit.

### Linear and reversible (rings only)

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 1 | Fibonacci | ℤ² | 1 | off | `b`, `a + b` | Six rings of length 60, 20, 12, 4, 3 and 1. |
| 2 | Fibonacci mod 100 | ℤ² | 2 | off | `b`, `a + b` | Same map, more digits; the longest ring is 300 (the Pisano period). |
| 3 | Pell | ℤ² | 2 | off | `b`, `a + 2b` | A different linear recurrence; still reversible, so still only rings. |
| 4 | Tribonacci | ℤ³ | 1 | off | `b`, `c`, `a + b + c` | Three-term Fibonacci. |
| 5 | Arnold's cat map | ℤ² | 2 | off | `a + b`, `a + 2b` | A classic chaotic map that is nonetheless a permutation. |
| 6 | Period six | ℤ² | 2 | off | `b`, `b - a` | Every cycle length divides 6. Turn negatives on to see the wrap break that. |
| 7 | Quarter turn | ℤ² | 1 | on | `b`, `-a` | Rotation by 90°: 4-cycles around a fixed origin. |
| 8 | Swap | ℤ² | 1 | off | `b`, `a` | 2-cycles, with the diagonal as fixed points. |
| 9 | Hénon | ℤ² | 2 | off | `b + 1 - a^2`, `a` | Reversible despite the square, so no trees. |
| 10 | Step by 8 | ℤ | 3 | off | `a + 8` | Eight rings of 125. |
| 11 | Full-period generator | ℤ | 3 | off | `21a + 1` | A random number generator that visits all 1000 states in one ring. |
| 12 | Broken generator | ℤ | 3 | off | `6a + 1` | The multiplier shares a factor with 1000, so it stops being reversible. |
| 13 | Times 3 | ℤ | 3 | off | `3a` | Reversible; ring lengths are the multiplicative orders of 3. |
| 14 | Riffle shuffle | ℤ | 3 | off | `a/2 + 500(a mod 2)` | A perfect shuffle of 1000 cards, as a permutation. |
| 15 | Digit rotation | ℤ | 3 | off | `(a mod 100)*10 + a/100` | Rotates the three digits: 3-cycles, with repdigits fixed. |

### Collapsing maps (trees)

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 16 | Doubling | ℤ | 3 | off | `2a` | Odd numbers are unreachable; shallow trees sit on rings. |
| 17 | Times 5 | ℤ | 3 | off | `5a` | Like doubling but five-way branching. |
| 18 | Halving | ℤ | 3 | off | `a / 2` | One binary tree draining into 0. |
| 19 | Squaring | ℤ | 3 | off | `a^2` | Four fixed points (0, 1, 376, 625) plus a few short cycles. |
| 20 | Cubing | ℤ | 3 | off | `a^3` | Compare its shape with squaring. |
| 21 | Pollard's rho | ℤ | 4 | off | `a^2 + 1` | The map behind rho factoring: tails feeding small cycles. |
| 22 | Lucas–Lehmer | ℤ | 3 | off | `a^2 - 2` | The step used in the Mersenne prime test. |
| 23 | Triangular | ℤ | 3 | off | `a(a + 1)/2` | Sends a to the a-th triangular number. |
| 24 | Logistic | ℤ | 3 | off | `a(999 - a)` | Integer logistic map; a and 999 − a always collide. |
| 25 | Exponential | ℤ | 3 | off | `2^a` | Powers of two, wrapped. |
| 26 | Self power | ℤ | 4 | off | `a^a` | Hundreds of small cycles, each with its own bushy tree. |
| 27 | Power tower | ℤ² | 2 | off | `a^b`, `b` | b never changes, so each b draws its own power map. |
| 28 | Quadratic pair | ℤ² | 2 | off | `b`, `a^2 + b` | The default: Fibonacci with a square. |
| 29 | Product and sum | ℤ² | 2 | off | `a*b`, `a + b` | Multiplication collapses many states together. |
| 30 | Averaging | ℤ² | 2 | off | `(a + b)/2`, `a` | Repeated averaging settles on the diagonal. |

### Piecewise maps

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 31 | Collatz | ℤ | 3 | off | `if(a mod 2 = 0, a/2, 3a + 1)` | The 3n+1 problem (large values wrap). |
| 32 | Collatz shortcut | ℤ | 3 | off | `if(a mod 2 = 0, a/2, (3a + 1)/2)` | Each odd step is merged with the halving that follows. |
| 33 | 5n + 1 | ℤ | 3 | off | `if(a mod 2 = 0, a/2, 5a + 1)` | The variant believed to have diverging orbits. |
| 34 | Negative Collatz | ℤ | 3 | on | `if(a mod 2 = 0, a/2, 3a + 1)` | Negative numbers have their own extra cycles. |
| 35 | Tent map | ℤ | 3 | off | `if(a < 500, 2a, 2(999 - a))` | Fold and stretch: every image has two preimages. |
| 36 | Gingerbreadman | ℤ² | 2 | on | `1 - b + abs(a)`, `a` | A piecewise-linear chaotic map. |
| 37 | Subtractive Euclid | ℤ² | 2 | off | `abs(a - b)`, `min(a, b)` | Euclid's algorithm: each state ends at (gcd, 0). |
| 38 | Euclid | ℤ² | 2 | off | `b`, `a mod b` | The division form, ending in the pair (gcd, 0) ↔ (0, gcd). |
| 39 | Sort | ℤ² | 2 | off | `min(a, b)`, `max(a, b)` | Every state is at most one step from a fixed point. |
| 40 | Ducci (4) | ℤ⁴ | 1 | off | `abs(a - b)`, `abs(b - c)`, `abs(c - d)`, `abs(d - a)` | The difference game on four numbers always reaches all zeros. |
| 41 | Ducci (3) | ℤ³ | 1 | off | `abs(a - b)`, `abs(b - c)`, `abs(c - a)` | With three numbers it gets stuck in 3-cycles instead. |

### Digits

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 42 | Digit append | ℤ² | 1 | off | `if(a + b < 10, b, 1)`, `(a + b) mod 10` | Append the sum of the last two digits: cycles 1123581347, 1459 and 00. |
| 43 | Kaprekar (4) | ℤ | 4 | off | `desc(a) - asc(a)` | Everything drains into 6174 (or 0 for repdigits). |
| 44 | Kaprekar (3) | ℤ | 3 | off | `desc(a) - asc(a)` | The three-digit constant is 495. |
| 45 | Happy numbers | ℤ | 3 | off | `(a/100)^2 + (a/10 mod 10)^2 + (a mod 10)^2` | Sum of squared digits: happy numbers reach 1, the rest fall into an 8-cycle. |
| 46 | Digit cubes | ℤ | 4 | off | `(a/1000)^3 + (a/100 mod 10)^3 + (a/10 mod 10)^3 + (a mod 10)^3` | Fixed points include 153, 370, 371 and 407. |
| 47 | Self numbers | ℤ | 3 | off | `a + digitsum(a)` | The unreachable states are the self numbers (wrap-around reaches a few of them). |
| 48 | Reverse and add | ℤ | 4 | off | `a + reverse(a)` | The palindrome (Lychrel) process, wrapped. |

### Bitwise

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 49 | Xorshift | ℤ | 4 | off | `a xor (a << 3) xor (a >> 2)` | The shape of a xorshift random generator. |
| 50 | Xor Fibonacci | ℤ² | 2 | off | `b`, `a xor b` | Fibonacci with xor in place of plus: mostly 3-cycles. |

### Larger views

These use the Sample limit setting. Spaces up to the limit are drawn whole; rows 62–65 are samples of million-state spaces.

| # | Name | Space | Digits | Negative | Limit | Formulas | What to look for |
|---|---|---|---|---|---|---|---|
| 51 | Kaprekar (5) | ℤ | 5 | off | 100k | `desc(a) - asc(a)` | No single constant at five digits: one 2-cycle and two 4-cycles (plus 0). |
| 52 | Collatz to 99,999 | ℤ | 5 | off | 100k | `if(a mod 2 = 0, a/2, 3a + 1)` | All 100,000 states: everything outside 0 drains into the 4 → 2 → 1 loop. |
| 53 | Pollard's rho (5) | ℤ | 5 | off | 100k | `a^2 + 1` | A single 6-cycle collects every state. |
| 54 | Happy numbers (5) | ℤ | 5 | off | 100k | `(a/10000)^2 + (a/1000 mod 10)^2 + (a/100 mod 10)^2 + (a/10 mod 10)^2 + (a mod 10)^2` | Still just 1 and the 8-cycle; almost every state is unreachable. |
| 55 | Self numbers (5) | ℤ | 5 | off | 100k | `a + digitsum(a)` | One long cycle of 4,735 fed by thousands of short tails. |
| 56 | Reverse and add (5) | ℤ | 5 | off | 100k | `a + reverse(a)` | Six cycles of length 44 (plus 0). |
| 57 | Xorshift (5) | ℤ | 5 | off | 100k | `a xor (a << 3) xor (a >> 2)` | Seven cycles, the longest 162. |
| 58 | Gingerbreadman, whole | ℤ² | 2 | on | 50k | `1 - b + abs(a)`, `a` | The whole space at once: 76 cycles, the longest 624. |
| 59 | Signed Fibonacci | ℤ² | 2 | on | 50k | `b`, `a + b` | With negatives the wrap is no longer reversible: a quarter of the states become unreachable. |
| 60 | Quarter turn (2) | ℤ² | 2 | on | 50k | `b`, `-a` | 9,900 four-cycles around the origin. |
| 61 | Negative Collatz (4) | ℤ | 4 | on | 50k | `if(a mod 2 = 0, a/2, 3a + 1)` | All five cycles of the signed 3n+1 map in one picture. |
| 62 | Digit append, 3-digit blocks | ℤ² | 3 | off | 100k | `a*10^digits(a+b) + concat(b, a+b)/1000`, `concat(b, a+b)` | A 100k sample of a million states; the full space has eight cycles, the longest 335. |
| 63 | Quadratic pair (3) | ℤ² | 3 | off | 100k | `b`, `a^2 + b` | The full space has 234 cycles; use Resample to tour different basins. |
| 64 | Tribonacci mod 100 | ℤ³ | 2 | off | 100k | `b`, `c`, `a + b + c` | Reversible: a sample of its 1,260 rings. |
| 65 | Fibonacci mod 1000 | ℤ² | 3 | off | 100k | `b`, `a + b` | A sample of its 1,372 rings, the longest 1,500. |
| 66 | Ducci (5) | ℤ⁵ | 1 | off | 100k | `abs(a - b)`, `abs(b - c)`, `abs(c - d)`, `abs(d - e)`, `abs(e - a)` | With five numbers the difference game falls into nine 15-cycles (or all zeros). |

### Number theory and custom modulus

A Digits entry of `mod N` means: type N into the "or modulus" box.

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 67 | Aliquot | ℤ | 4 | off | `sigma(a) - a` | Sum of proper divisors: perfect numbers are fixed points, amicable pairs such as 220 and 284 are 2-cycles. |
| 68 | Totient | ℤ | 4 | off | `phi(a)` | One tree draining into the fixed point 1 (0 stays at 0). |
| 69 | Prime peeling | ℤ | 4 | off | `a / spf(a)` | Strips one prime factor per step, so everything ends at 1. |
| 70 | Juggler | ℤ | 4 | off | `if(a mod 2 = 0, isqrt(a), isqrt(a^3))` | The juggler sequence, a square-root relative of Collatz. |
| 71 | Multiplicative persistence | ℤ | 4 | off | `digitprod(a)` | Multiplicative persistence: every number collapses onto one of the ten single digits. |
| 72 | Root-paced growth | ℤ | 4 | off | `a + isqrt(a)` | Two long cycles (194 and 372) and almost no unreachable states. |
| 73 | Rho over a prime field | ℤ | mod 997 | off | `a^2 + 1` | Five cycles over a prime field; compare example 21, where a single 6-cycle takes everything. |
| 74 | 12-bit xorshift | ℤ | mod 4096 | off | `a xor (a << 3) xor (a >> 2)` | With a power-of-two modulus the shifts wrap as they do in hardware; half the states are unreachable. |
| 75 | Fibonacci over a prime field | ℤ² | mod 97 | off | `b`, `a + b` | Only rings: 48 of length 196 around the fixed origin. |
| 76 | lcm and gcd | ℤ² | 2 | off | `lcm(a, b)`, `gcd(a, b)` | Collapses onto 573 fixed points. |

### Complex numbers, quaternions and mixed moduli

ℂ and ℍ are the number-system switch next to Space. A Digits entry of `mod 100, 99` means one modulus per variable: type them into the small `mod` box after each formula.

| # | Name | Space | Digits | Negative | Formulas | What to look for |
|---|---|---|---|---|---|---|
| 77 | Complex squaring | ℂ | mod 31 | off | `a^2` | Squaring in the Gaussian integers mod 31. Since 31 leaves remainder 3 when divided by 4, this is a field of 961 elements, and half the states are unreachable. |
| 78 | Julia-style | ℂ | mod 31 | off | `a^2 + i` | z² + i: just two cycles, of length 2 and 19. |
| 79 | Gaussian Fibonacci | ℂ² | 1 | off | `b`, `a + i*b` | Reversible: 832 rings of length 12. |
| 80 | Complex Hénon | ℂ² | 1 | off | `b + 1 - a^2`, `a` | Reversible like its integer version (example 9): 700 rings, the longest 18. |
| 81 | Quaternion square | ℍ | 1 | off | `a^2 + j` | q² + j: 12 cycles, and 9,554 of the 10,000 states are unreachable. |
| 82 | Quaternion sandwich | ℍ | 1 | off | `i*a*j` | q ↦ iqj applied twice gives q back, so there are only fixed points and 2-cycles. |
| 83 | Commutator | ℍ | 1 | off | `a*i - i*a` | The commutator with i depends only on the j and k parts: almost every state is unreachable, and all end in 15 short cycles. |
| 84 | Quaternion cube | ℍ | mod 7 | off | `a^3 + 1` | Quaternions mod 7: 43 fixed points and eight 6-cycles. |
| 85 | Mixed-moduli Fibonacci | ℤ² | mod 100, 99 | off | `b`, `a + b` | Fibonacci with a mod 100 and b mod 99 is no longer reversible: 99 unreachable states, 114 cycles, the longest 120. |
| 86 | Mixed-moduli quadratic | ℤ² | mod 64, 81 | off | `b`, `a^2 + b` | Compare example 28: 16 cycles, the longest 30. |

### Digit append with longer blocks

Example 42 is the 1-digit case of this rule: take the last two k-digit blocks of a string, add them, append the sum, repeat (`11 34` → `113445` → `11344579` → …). For any block size k, set the space to ℤ², Digits to k, and use

```
a*10^digits(a+b) + concat(b, a+b) / 10^k
concat(b, a+b)
```

with `10^k` written out:

| Digits | Formulas | Cycles |
|---|---|---|
| 2 | `a*10^digits(a+b) + concat(b, a+b)/100`, `concat(b, a+b)` | 6 |
| 3 | `a*10^digits(a+b) + concat(b, a+b)/1000`, `concat(b, a+b)` | 8 |

`concat(b, a+b)` writes the sum after the last block; wrapping to k digits keeps the new last block, and the first formula does the same one block higher. The cycle counts include the all-zeros fixed point.

## Run

```bash
npm install
npm run dev
```

More saved renders are in [`examples/`](examples).

`npm test` runs the engine tests. Built with React, Vite and Tailwind.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE); redistributions and derivative works must keep the NOTICE attribution.
