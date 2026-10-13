// Planar layout for functional graphs (every node has out-degree <= 1).
//
// Each weakly connected component is one cycle with in-trees hanging off it, which is
// always planar. We draw the cycle on a circle and the trees on concentric rings outside
// it, giving every subtree its own angular wedge. Tree edges are drawn linear in polar
// coordinates (theta interpolates with r), so two edges between the same pair of rings can
// only cross if their endpoints swap order - which wedges forbid. Components are then
// circle-packed. Everything is O(m) apart from a few bisections per component.
import { packSiblings } from 'd3-hierarchy'

export const SPACING = 10 // min arc distance between neighbours on a ring (world units)
const RING_SPACING = SPACING * 1.3
const DR_MIN = SPACING * 1.6 // min distance between consecutive depth rings
const PAD = SPACING * 1.4
const ROW = SPACING * 0.85 // radial pitch of staggered leaf rows
const MAX_ROWS = 6
const SPINE_MIN = 16 // open chains at least this long are bent into an arc instead of a ray
const TAU = Math.PI * 2

export function layout(m, succ) {
  // ---- 1. components: find each walk's terminal (a cycle, or a node whose successor is not shown)
  const comp = new Int32Array(m).fill(-1)
  const mark = new Uint8Array(m)
  const onRing = new Uint8Array(m)
  const rings = [] // per component: ordered node ids
  const closed = [] // per component: ring is a real cycle
  for (let s = 0; s < m; s++) {
    if (mark[s]) continue
    let x = s, last = -1
    while (x >= 0 && !mark[x]) { mark[x] = 1; last = x; x = succ[x] }
    let c
    if (x < 0) { c = rings.length; rings.push([last]); closed.push(false) }
    else if (mark[x] === 1) {
      const ring = []
      let y = x
      do { ring.push(y); y = succ[y] } while (y !== x)
      c = rings.length; rings.push(ring); closed.push(true)
    } else c = comp[x]
    for (x = s; x >= 0 && mark[x] === 1; x = succ[x]) { mark[x] = 2; comp[x] = c }
  }
  const nc = rings.length
  for (let c = 0; c < nc; c++) if (closed[c]) for (const v of rings[c]) onRing[v] = 1

  // ---- 2. children in CSR form
  const cOff = new Int32Array(m + 2)
  for (let v = 0; v < m; v++) if (succ[v] >= 0) cOff[succ[v] + 2]++
  for (let i = 2; i < m + 2; i++) cOff[i] += cOff[i - 1]
  const cList = new Int32Array(m)
  for (let v = 0; v < m; v++) if (succ[v] >= 0) cList[cOff[succ[v] + 1]++] = v

  const ord = new Int32Array(m)
  const depth = new Int32Array(m)

  // ---- 3. open components: use the longest path into the root as the "ring" when it is long
  {
    let n = 0
    for (let c = 0; c < nc; c++) for (const v of rings[c]) ord[n++] = v
    for (let q = 0; q < n; q++) {
      const v = ord[q]
      for (let j = cOff[v], e = cOff[v + 1]; j < e; j++) if (!mark[cList[j]] || mark[cList[j]] === 2) {
        const ch = cList[j]
        if (onRing[ch] || (comp[ch] >= 0 && !closed[comp[ch]] && rings[comp[ch]][0] === ch)) continue
        ord[n++] = ch
      }
    }
    const h = depth // borrow as scratch: height of each node's subtree
    for (let q = n - 1; q >= 0; q--) {
      const v = ord[q], p = succ[v]
      if (p >= 0 && !onRing[v] && h[v] + 1 > h[p]) h[p] = h[v] + 1
    }
    for (let c = 0; c < nc; c++) {
      if (closed[c]) continue
      let v = rings[c][0]
      if (h[v] < SPINE_MIN) continue
      const spine = [v]
      while (h[v] > 0) {
        for (let j = cOff[v], e = cOff[v + 1]; j < e; j++) if (h[cList[j]] === h[v] - 1) { v = cList[j]; break }
        spine.push(v)
      }
      rings[c] = spine.reverse()
    }
    for (let c = 0; c < nc; c++) if (!closed[c]) for (const v of rings[c]) onRing[v] = 1
    depth.fill(0)
  }

  // ---- 4. per-component radial layout
  const A = new Float64Array(m) // angular need of the subtree
  const kids = new Float64Array(m) // sum of children's needs
  const acc = new Float64Array(m)
  const w0 = new Float64Array(m), ww = new Float64Array(m)
  const rad = new Float64Array(m) // polar coordinates relative to the component centre
  // Leaf siblings are staggered over several rows (a seed-head pattern), so a fan of k
  // leaves needs 1/rows of the arc. inv = 1/rows, row = which row the leaf sits in.
  const inv = new Float32Array(m).fill(1)
  const row = new Uint8Array(m)
  const segs = new Uint8Array(m) // polyline segments of the edge leaving each node
  const x = new Float32Array(m), y = new Float32Array(m)
  const level = new Uint8Array(m)
  const circles = new Array(nc)
  let n = 0
  for (let c = 0; c < nc; c++) {
    const ring = rings[c], L = ring.length, st = n
    for (let i = 0; i < L; i++) ord[n++] = ring[i]
    let maxD = 0
    for (let q = st; q < n; q++) {
      const v = ord[q]
      for (let j = cOff[v], e = cOff[v + 1]; j < e; j++) {
        const ch = cList[j]
        if (onRing[ch]) continue
        depth[ch] = depth[v] + 1
        if (depth[ch] > maxD) maxD = depth[ch]
        ord[n++] = ch
      }
    }
    const en = n
    for (let q = st; q < en; q++) {
      const v = ord[q]
      let cnt = 0
      for (let j = cOff[v], e = cOff[v + 1]; j < e; j++) if (!onRing[cList[j]] && cOff[cList[j]] === cOff[cList[j] + 1]) cnt++
      if (cnt < 4) continue
      const rows = Math.min(MAX_ROWS, Math.round(Math.sqrt(cnt)))
      for (let j = cOff[v], e = cOff[v + 1], i = 0; j < e; j++) {
        const ch = cList[j]
        if (!onRing[ch] && cOff[ch] === cOff[ch + 1]) { inv[ch] = 1 / rows; row[ch] = i++ % rows }
      }
    }
    const avail = closed[c] || L === 1 ? TAU : TAU * 0.92

    // Angular need at ring radius r is SPACING / r, or the children's total if larger.
    const need = (R0, DR) => {
      let total = 0
      for (let i = en - 1; i >= st; i--) {
        const v = ord[i], d = depth[v], s = acc[v]
        acc[v] = 0; kids[v] = s
        if (d === 0) { const a = L > 1 ? Math.max(RING_SPACING / R0, s) : s; A[v] = a; total += a }
        else { const a = Math.max((SPACING * inv[v]) / (R0 + d * DR), s); A[v] = a; acc[succ[v]] += a }
      }
      return total
    }
    // Smallest inner radius whose total need fits the available angle, for a given ring pitch.
    const R0min = L > 1 ? (L * RING_SPACING) / avail : 0
    const solve = (DR) => {
      if (need(R0min, DR) <= avail * (1 + 1e-9)) return R0min
      let a = R0min, b = Math.max(R0min, SPACING) * 2
      while (need(b, DR) > avail) { a = b; b *= 2 }
      for (let i = 0; i < 24 && b - a > 0.01 * b; i++) { const mid = (a + b) / 2; if (need(mid, DR) > avail) a = mid; else b = mid }
      return b
    }
    // Trade inner radius against ring pitch: a wide pitch fills the disc (short fat trees),
    // a narrow one keeps deep trees compact. Take the widest pitch within 10% of the smallest disc.
    let R0 = R0min, DR = DR_MIN
    if (maxD > 0) {
      const cand = []
      let best = Infinity
      for (let dr = DR_MIN; cand.length < 12; dr *= 1.6) {
        const r0 = solve(dr), outer = r0 + maxD * dr
        cand.push([r0, dr, outer])
        if (outer < best) best = outer
        if (r0 === R0min || outer > best * 1.5) break
      }
      for (const k of cand) if (k[2] <= best * 1.1) { R0 = k[0]; DR = k[1] }
    }
    const total = need(R0, DR)

    // Hand out wedges top-down; children stay inside the tangent cone of their parent so
    // an edge never dips below its parent's ring (which is what would create a crossing).
    const scale = total > 0 ? avail / total : 1
    if (L === 1) { w0[ring[0]] = 0; ww[ring[0]] = TAU; x[ring[0]] = 0; y[ring[0]] = 0; rad[ring[0]] = 0 }
    else {
      let cur = -Math.PI / 2 + (TAU - avail) / 2
      for (let i = 0; i < L; i++) {
        const v = ring[i], w = A[v] * scale
        w0[v] = cur; ww[v] = w; rad[v] = R0
        x[v] = R0 * Math.cos(cur + w / 2); y[v] = R0 * Math.sin(cur + w / 2)
        cur += w
      }
    }
    let outer = L > 1 ? R0 : 0
    for (let q = st; q < en; q++) {
      const v = ord[q], d = depth[v], s = kids[v]
      level[v] = d === 0 ? 0 : 1 + Math.min(4, Math.floor((5 * (d - 1)) / maxD))
      if (s <= 0) continue
      const rk = d === 0 ? (L > 1 ? R0 : 0) : R0 + d * DR
      const rk1 = R0 + (d + 1) * DR
      const cone = rk === 0 ? Infinity : 2 * Math.acos(rk / rk1)
      const span = Math.min(ww[v], Math.max(s, cone))
      // Inside the cone straight rays from the parent are safe (and never cross each other).
      // Otherwise the whole fan switches to polar-linear curves with a shared subdivision.
      const k = span <= cone * (1 + 1e-9) ? 1 : Math.min(32, Math.ceil((span * rk1) / (3 * SPACING)) + 1)
      let cur = w0[v] + (ww[v] - span) / 2
      for (let j = cOff[v], e = cOff[v + 1]; j < e; j++) {
        const ch = cList[j]
        if (onRing[ch]) continue
        const w = (span * A[ch]) / s
        const r = rk1 + row[ch] * ROW
        if (r > outer) outer = r
        w0[ch] = cur; ww[ch] = w; rad[ch] = r; segs[ch] = k
        x[ch] = r * Math.cos(cur + w / 2); y[ch] = r * Math.sin(cur + w / 2)
        cur += w
      }
    }
    circles[c] = {
      r: outer + PAD,
      c, st, en, x: 0, y: 0, ringR: L > 1 ? R0 : 0, maxD,
    }
  }

  // ---- 5. pack components, largest in the middle
  circles.sort((p, q) => q.r - p.r || q.en - q.st - (p.en - p.st))
  packSiblings(circles)
  const compX = new Float32Array(nc), compY = new Float32Array(nc), compR = new Float32Array(nc)
  const compSize = new Int32Array(nc), compRing = new Int32Array(nc), compClosed = new Uint8Array(nc)
  const compRingR = new Float32Array(nc)
  const keys = new Float64Array(m)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < nc; i++) {
    const k = circles[i]
    compX[i] = k.x; compY[i] = k.y; compR[i] = k.r
    compSize[i] = k.en - k.st; compRing[i] = rings[k.c].length; compClosed[i] = closed[k.c] ? 1 : 0
    compRingR[i] = k.ringR
    for (let q = k.st; q < k.en; q++) {
      const v = ord[q]
      comp[v] = i; x[v] += k.x; y[v] += k.y
      // draw order: by component, deepest first so cycle nodes paint on top
      keys[v] = (i * 8 + (7 - level[v])) * 16384 + v
    }
    if (k.x - k.r < minX) minX = k.x - k.r
    if (k.x + k.r > maxX) maxX = k.x + k.r
    if (k.y - k.r < minY) minY = k.y - k.r
    if (k.y + k.r > maxY) maxY = k.y + k.r
  }
  keys.sort()
  const order = new Uint32Array(m)
  for (let i = 0; i < m; i++) order[i] = keys[i] % 16384

  // ---- 6. edge polylines (child -> parent), flattened: edge v owns points [edgeOff[v], edgeOff[v+1])
  const edgeOff = new Uint32Array(m + 1)
  for (let v = 0; v < m; v++) {
    const p = succ[v]
    if (p < 0 || p === v) segs[v] = 0
    else if (onRing[v] && onRing[p]) segs[v] = 1
    edgeOff[v + 1] = edgeOff[v] + (segs[v] ? segs[v] + 1 + (row[v] ? 1 : 0) : 0)
  }
  const edgePts = new Float32Array(edgeOff[m] * 2)
  for (let v = 0; v < m; v++) {
    const k = segs[v]
    if (!k) continue
    const p = succ[v]
    let o = edgeOff[v] * 2
    edgePts[o++] = x[v]; edgePts[o++] = y[v]
    const cx = compX[comp[v]], cy = compY[comp[v]]
    const t0 = w0[v] + ww[v] / 2, t1 = w0[p] + ww[p] / 2
    // a staggered leaf first drops radially onto its ring, so it never sweeps over a sibling's subtree
    const rv = rad[v] - row[v] * ROW
    if (row[v]) { edgePts[o++] = cx + rv * Math.cos(t0); edgePts[o++] = cy + rv * Math.sin(t0) }
    for (let i = 1; i < k; i++) {
      const t = i / k, r = rv + (rad[p] - rv) * t, th = t0 + (t1 - t0) * t
      edgePts[o++] = cx + r * Math.cos(th); edgePts[o++] = cy + r * Math.sin(th)
    }
    edgePts[o++] = x[p]; edgePts[o] = y[p]
  }

  return {
    x, y, comp, depth, level, onRing, order, edgeOff, edgePts,
    compX, compY, compR, compSize, compRing, compClosed, compRingR,
    bounds: [minX, minY, maxX, maxY],
  }
}
