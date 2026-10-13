// Builds the (sub)graph of the map: full enumeration when the state space is small enough,
// forward-orbit sampling otherwise.
import { compile } from './compile.js'

export const DEFAULT_BUDGET = 10000 // default max nodes drawn (params.limit overrides)
export const MAX_BUDGET = 100000
export { DEFAULT_BUDGET as BUDGET }
export const ENUM_LIMIT = 1 << 24 // max states we fully enumerate (12 bytes/state peak)
const CHUNK = 1 << 17

export function build(params, onProgress = () => {}) {
  const { dims, formulas } = params
  const BUDGET = Math.min(MAX_BUDGET, params.limit ?? DEFAULT_BUDGET)
  const c = compile(formulas.slice(0, dims), params)
  const { R, lo } = c
  const Nbig = BigInt(R) ** BigInt(dims)
  const base = { totalStates: Nbig.toString(), tiers: c.tiers }
  return Nbig <= BigInt(ENUM_LIMIT)
    ? enumerate(c, dims, Number(Nbig), base, onProgress)
    : sample(c, dims, Nbig, base, onProgress)

  function decode(g, out, at) {
    for (let i = dims - 1; i >= 0; i--) { out[at + i] = (g % R) + lo; g = Math.floor(g / R) }
  }

  // ---------- exact: every state visited once, O(N) time, 12N bytes ----------
  function enumerate(c, dims, N, base, onProgress) {
    const next = new Uint32Array(N)
    for (let from = 0; from < N; from += CHUNK) {
      c.fill(next, from, Math.min(N, from + CHUNK))
      onProgress(Math.min(1, (from + CHUNK) / N) * 0.7)
    }

    // Cycle census: 0 unseen, 1 on current walk, 2 settled tail, 3 settled cycle. Each state is touched <= 3 times.
    const mark = new Uint8Array(N)
    const census = new Map()
    let cycles = 0, cyclic = 0, longest = 0
    for (let s = 0; s < N; s++) {
      if (mark[s]) continue
      let x = s
      while (!mark[x]) { mark[x] = 1; x = next[x] }
      if (mark[x] === 1) {
        let len = 0, y = x
        do { mark[y] = 3; y = next[y]; len++ } while (y !== x)
        cycles++; cyclic += len
        if (len > longest) longest = len
        census.set(len, (census.get(len) || 0) + 1)
      }
      x = s
      while (mark[x] === 1) { mark[x] = 2; x = next[x] }
    }
    onProgress(0.8)

    // Predecessor lists in CSR form via counting sort (two flat arrays, no per-node allocation).
    const off = new Uint32Array(N + 2)
    for (let i = 0; i < N; i++) off[next[i] + 2]++
    for (let i = 2; i < N + 2; i++) off[i] += off[i - 1]
    const pred = new Uint32Array(N)
    for (let i = 0; i < N; i++) pred[off[next[i] + 1]++] = i
    let leaves = 0
    for (let i = 0; i < N; i++) if (off[i] === off[i + 1]) leaves++
    onProgress(0.9)

    let m, glob, succ, truncated = false
    if (N <= BUDGET) {
      m = N
      glob = new Uint32Array(N)
      for (let i = 0; i < N; i++) glob[i] = i
      succ = Int32Array.from(next)
    } else {
      // Start from a random state's cycle and grow outwards breadth-first through predecessors.
      truncated = true
      glob = new Uint32Array(BUDGET)
      const local = new Map()
      m = 0
      const add = (g) => { local.set(g, m); glob[m++] = g }
      const grow = (c0) => {
        const start = m
        let y = c0
        do { add(y); y = next[y] } while (y !== c0 && m < BUDGET)
        for (let q = start; q < m && m < BUDGET; q++) {
          const g = glob[q]
          for (let j = off[g], e = off[g + 1]; j < e && m < BUDGET; j++) {
            if (!local.has(pred[j])) add(pred[j])
          }
        }
      }
      // If a basin is exhausted before the budget, continue with further random basins.
      for (let fails = 0; m < BUDGET && fails < 256; ) {
        let s = Math.floor(Math.random() * N)
        while (mark[s] !== 3) s = next[s]
        if (local.has(s)) fails++
        else grow(s)
      }
      succ = new Int32Array(m)
      for (let i = 0; i < m; i++) succ[i] = local.get(next[glob[i]]) ?? -1
      glob = glob.subarray(0, m)
    }

    const coords = new Int32Array(m * dims)
    const flags = new Uint8Array(m) // bit0: on a cycle, bit1: no predecessor anywhere
    for (let i = 0; i < m; i++) {
      const g = glob[i]
      decode(g, coords, i * dims)
      flags[i] = (mark[g] === 3 ? 1 : 0) | (off[g] === off[g + 1] ? 2 : 0)
    }
    return {
      m, coords, succ, flags,
      stats: {
        ...base, mode: 'exact', truncated, shown: m, limit: BUDGET,
        cycles, cyclic, longest, leaves,
        census: [...census].sort((a, b) => a[0] - b[0]),
      },
    }
  }

  // ---------- too large to enumerate: predecessors are unknowable, follow orbits forward ----------
  function sample(c, dims, Nbig, base, onProgress) {
    const numericKey = Nbig < BigInt(Number.MAX_SAFE_INTEGER)
    const key = numericKey
      ? (s) => { let k = 0; for (let i = 0; i < dims; i++) k = k * R + (s[i] - lo); return k }
      : (s) => s.join(',')
    const rnd = (s) => { for (let i = 0; i < dims; i++) s[i] = lo + Math.floor(Math.random() * R) }
    const eq = (p, q) => { for (let i = 0; i < dims; i++) if (p[i] !== q[i]) return false; return true }
    const maxSteps = c.tiers.includes('bigint') ? 2e6 : 3e7

    // Brent's cycle detection: O(mu + lambda) steps, O(1) memory.
    const x0 = new Float64Array(dims)
    rnd(x0)
    let tort = Float64Array.from(x0), hare = new Float64Array(dims), tmp = new Float64Array(dims)
    c.step(tort, hare)
    let power = 1, lam = 1, steps = 1, found = true
    while (!eq(tort, hare)) {
      if (power === lam) { tort.set(hare); power *= 2; lam = 0 }
      c.step(hare, tmp); [hare, tmp] = [tmp, hare]
      lam++
      if (++steps > maxSteps) { found = false; break }
      if ((steps & 0xfffff) === 0) onProgress(Math.min(0.9, steps / maxSteps))
    }
    let mu = 0
    if (found) {
      tort.set(x0); hare.set(x0)
      for (let i = 0; i < lam; i++) { c.step(hare, tmp); [hare, tmp] = [tmp, hare] }
      while (!eq(tort, hare)) {
        c.step(tort, tmp); [tort, tmp] = [tmp, tort]
        c.step(hare, tmp); [hare, tmp] = [tmp, hare]
        mu++
      }
    }

    const local = new Map()
    const coords = new Int32Array(BUDGET * dims)
    const succ = new Int32Array(BUDGET).fill(-1)
    const flags = new Uint8Array(BUDGET)
    let m = 0
    // Appends the forward orbit of `s` (mutated) until it meets a known state or `limit` nodes were added.
    const walk = (s, limit, flag) => {
      let prev = -1
      for (let n = 0; ; n++) {
        const k = key(s)
        const hit = local.get(k)
        if (hit !== undefined) { if (prev >= 0) succ[prev] = hit; return }
        if (n >= limit || m >= BUDGET) return
        local.set(k, m)
        coords.set(s, m * dims)
        flags[m] = flag
        if (prev >= 0) succ[prev] = m
        prev = m++
        c.step(s, tmp); s.set(tmp)
      }
    }
    const cur = new Float64Array(dims)
    if (found) {
      cur.set(tort) // first state on the cycle
      walk(cur, BUDGET, 1)
      const tail = Math.min(mu, BUDGET - m)
      cur.set(x0)
      for (let i = mu - tail; i > 0; i--) { c.step(cur, tmp); cur.set(tmp) }
      walk(cur, tail, 0)
    } else {
      cur.set(x0)
      walk(cur, BUDGET >> 1, 0)
    }
    for (let tries = 0; m < BUDGET && tries < 4 * BUDGET; tries++) {
      rnd(cur)
      walk(cur, 400, 0)
    }
    return {
      m, coords: coords.slice(0, m * dims), succ: succ.slice(0, m), flags: flags.slice(0, m),
      stats: {
        ...base, mode: 'sampled', truncated: true, shown: m, limit: BUDGET,
        found, lambda: found ? lam : null, mu: found ? mu : null, maxSteps,
      },
    }
  }
}
