import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { PALETTE, SURFACE, OPEN_SLOT } from './palette.js'
import { VAR_NAMES } from './engine/parser.js'

const R_CYCLE = 3.4, R_TREE = 2.3, R_LEAF = 1.7
const ARROW_ZOOM = 2.4 // px per world unit at which arrowheads appear
const fmt = (n) => String(n).replace('-', '−')
// one variable's components as an integer, x+yi, or w+xi+yj+zk (zero terms dropped)
const fmtValue = (c) => {
  if (c.length === 1) return fmt(c[0])
  const terms = c.map((v, k) => [v, ['', 'i', 'j', 'k'][k]]).filter(([v], k) => v !== 0 || (k === 0 && c.every((u) => u === 0)))
  return terms.map(([v, u], k) => `${v < 0 ? '−' : k ? '+' : ''}${Math.abs(v) === 1 && u ? '' : Math.abs(v)}${u}`).join('')
}

// Uniform grid over node positions in CSR form, for O(1) hover lookups.
function buildGrid(g) {
  const [minX, minY, maxX, maxY] = g.bounds
  const cell = Math.max(20, Math.max(maxX - minX, maxY - minY) / 512)
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell)), rows = Math.max(1, Math.ceil((maxY - minY) / cell))
  const off = new Uint32Array(cols * rows + 2)
  const cellOf = (i) => Math.min(cols - 1, Math.floor((g.x[i] - minX) / cell)) + cols * Math.min(rows - 1, Math.floor((g.y[i] - minY) / cell))
  for (let i = 0; i < g.m; i++) off[cellOf(i) + 2]++
  for (let i = 2; i < off.length; i++) off[i] += off[i - 1]
  const items = new Uint32Array(g.m)
  for (let i = 0; i < g.m; i++) items[off[cellOf(i) + 1]++] = i
  return { minX, minY, cell, cols, rows, off, items }
}

export default function GraphCanvas({ graph, slots, ref }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const tipRef = useRef(null)
  const S = useRef({ pinned: -1, k: 1, tx: 0, ty: 0, w: 0, h: 0, dpr: 1, hover: -1, raf: 0, grid: null, graph: null, slots: null, compStart: null }).current
  const [tip, setTip] = useState(null)

  const schedule = () => { if (!S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; draw() }) }

  function fit() {
    const g = S.graph
    if (!g || !S.w) return
    const [minX, minY, maxX, maxY] = g.bounds
    const bw = Math.max(maxX - minX, 60), bh = Math.max(maxY - minY, 60)
    S.k = Math.min(S.w / bw, S.h / bh) * 0.88
    S.fitK = S.k
    S.tx = S.w / 2 - ((minX + maxX) / 2) * S.k
    S.ty = S.h / 2 - ((minY + maxY) / 2) * S.k
    schedule()
  }
  function zoomAt(px, py, f) {
    const k = Math.min(60, Math.max((S.fitK || 1) * 0.4, S.k * f))
    f = k / S.k
    S.tx = px - (px - S.tx) * f
    S.ty = py - (py - S.ty) * f
    S.k = k
    schedule()
  }
  // Renders the current view (without hover highlight) into a fresh canvas at `scale` device pixels per CSS pixel.
  function snapshot(scale) {
    if (!S.graph || !S.w) return null
    const cv = document.createElement('canvas')
    cv.width = Math.round(S.w * scale); cv.height = Math.round(S.h * scale)
    render(cv.getContext('2d'), scale, -1)
    return cv
  }
  // Search: the node whose components equal `values` (K = dims * comps integers), or -1.
  function find(values) {
    const g = S.graph
    if (!g) return -1
    const K = g.dims * (g.comps || 1)
    outer: for (let i = 0; i < g.m; i++) {
      for (let k = 0; k < K; k++) if (g.coords[i * K + k] !== values[k]) continue outer
      return i
    }
    return -1
  }
  // Pins the hover highlight on a node and brings it into view, zoomed in far enough to see its neighbours.
  function focus(v) {
    const g = S.graph
    S.pinned = v
    S.k = Math.max(S.k, Math.min(4, (S.fitK || 1) * 8))
    S.tx = S.w / 2 - g.x[v] * S.k
    S.ty = S.h / 2 - g.y[v] * S.k
    if (S.hover < 0) setTip(describe(v))
    schedule()
  }
  function clearFocus() {
    S.pinned = -1
    if (S.hover < 0) setTip(null)
    schedule()
  }
  useImperativeHandle(ref, () => ({ fit, zoom: (f) => zoomAt(S.w / 2, S.h / 2, f), snapshot, find, focus, clearFocus }))

  function placeTip(mx, my) {
    const el = tipRef.current
    if (!el) return
    const flipX = mx > S.w - 280, flipY = my > S.h - 150
    el.style.transform = `translate(${mx + (flipX ? -14 : 14)}px, ${my + (flipY ? -14 : 14)}px) translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`
  }

  function draw() {
    const cv = canvasRef.current
    if (!cv) return
    const shown = S.hover >= 0 ? S.hover : S.pinned
    render(cv.getContext('2d'), S.dpr, shown)
    // a pinned (searched) node keeps its tooltip attached as the view moves
    if (S.hover < 0 && S.pinned >= 0 && S.graph) placeTip(S.graph.x[S.pinned] * S.k + S.tx, S.graph.y[S.pinned] * S.k + S.ty)
  }
  function render(ctx, dpr, hover) {
    const g = S.graph, { k, tx, ty } = S
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = SURFACE
    ctx.fillRect(0, 0, S.w, S.h)
    if (!g) return
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty)
    ctx.lineJoin = ctx.lineCap = 'round'
    const vx0 = -tx / k, vy0 = -ty / k, vx1 = (S.w - tx) / k, vy1 = (S.h - ty) / k
    const { x, y, succ, order, onRing, level, flags, edgeOff, edgePts, compX, compY, compR } = g
    const nc = compR.length, start = S.compStart, slots = S.slots
    const px = 1 / k

    // Component-level culling and level of detail.
    const vis = S.vis
    for (let c = 0; c < nc; c++) {
      const r = compR[c]
      vis[c] = compX[c] + r < vx0 || compX[c] - r > vx1 || compY[c] + r < vy0 || compY[c] - r > vy1 ? 0 : r * k < 1.2 ? 1 : 2
    }
    const inView = (i, pad) => x[i] > vx0 - pad && x[i] < vx1 + pad && y[i] > vy0 - pad && y[i] < vy1 + pad
    const cullNodes = k > 1.5 // only worth testing per node once most of the graph is off-screen

    // 1. tree edges, one path per component
    ctx.lineWidth = Math.max(0.75 * px, 0.55)
    let style = null
    for (let c = 0; c < nc; c++) {
      if (vis[c] !== 2) continue
      const s = PALETTE[slots[c]].edge
      if (s !== style) ctx.strokeStyle = style = s
      ctx.beginPath()
      for (let q = start[c], e = start[c + 1]; q < e; q++) {
        const v = order[q], a = edgeOff[v], b = edgeOff[v + 1]
        if (a === b || (onRing[v] && onRing[succ[v]])) continue
        ctx.moveTo(edgePts[2 * a], edgePts[2 * a + 1])
        for (let i = a + 1; i < b; i++) ctx.lineTo(edgePts[2 * i], edgePts[2 * i + 1])
      }
      ctx.stroke()
    }

    // 2. cycle edges (and self-loops)
    ctx.lineWidth = Math.max(1.5 * px, 1.3)
    style = null
    for (let c = 0; c < nc; c++) {
      if (vis[c] !== 2) continue
      const s = PALETTE[slots[c]].ring
      if (s !== style) ctx.strokeStyle = style = s
      ctx.beginPath()
      // ring nodes have level 0, so they sit at the end of the component's draw range
      for (let q = start[c + 1] - 1; q >= start[c]; q--) {
        const v = order[q]
        if (!onRing[v]) break
        const p = succ[v]
        if (p === v) { ctx.moveTo(x[v] + 5, y[v] - 5.5); ctx.arc(x[v], y[v] - 5.5, 5, 0, 6.2832) }
        else if (p >= 0 && onRing[p]) { ctx.moveTo(x[v], y[v]); ctx.lineTo(x[p], y[p]) }
      }
      ctx.stroke()
    }

    // 3. arrowheads, once there is room for them
    if (k >= ARROW_ZOOM) {
      for (let c = 0; c < nc; c++) {
        if (vis[c] !== 2) continue
        const pal = PALETTE[slots[c]]
        for (let pass = 0; pass < 2; pass++) {
          ctx.fillStyle = pass ? pal.ring : pal.edge
          ctx.beginPath()
          for (let q = start[c], e = start[c + 1]; q < e; q++) {
            const v = order[q], a = edgeOff[v], b = edgeOff[v + 1], p = succ[v]
            if (a === b || (onRing[v] && onRing[p] ? 1 : 0) !== pass || !inView(p, 8)) continue
            const ex = edgePts[2 * b - 2], ey = edgePts[2 * b - 1]
            let dx = ex - edgePts[2 * b - 4], dy = ey - edgePts[2 * b - 3]
            const d = Math.hypot(dx, dy)
            if (d < 1e-6) continue
            dx /= d; dy /= d
            const back = (onRing[p] ? R_CYCLE : R_TREE) + 0.6, hx = ex - dx * back, hy = ey - dy * back
            ctx.moveTo(hx, hy)
            ctx.lineTo(hx - dx * 3.4 - dy * 1.5, hy - dy * 3.4 + dx * 1.5)
            ctx.lineTo(hx - dx * 3.4 + dy * 1.5, hy - dy * 3.4 - dx * 1.5)
          }
          ctx.fill()
        }
      }
    }

    // 4. nodes, batched by (component, level); squares when sub-pixel, discs otherwise
    for (let c = 0; c < nc; c++) {
      if (!vis[c]) continue
      const pal = PALETTE[slots[c]]
      if (vis[c] === 1) { // whole component is about a pixel
        ctx.fillStyle = pal.node[0]
        ctx.fillRect(compX[c] - px, compY[c] - px, 2 * px, 2 * px)
        continue
      }
      let lv = -1
      for (let q = start[c], e = start[c + 1]; q < e; q++) {
        const v = order[q]
        if (level[v] !== lv) {
          if (lv >= 0) ctx.fill()
          lv = level[v]
          ctx.fillStyle = pal.node[lv]
          ctx.beginPath()
        }
        if (cullNodes && !inView(v, 6)) continue
        const r = lv === 0 ? R_CYCLE : flags[v] & 2 ? R_LEAF : R_TREE
        if (r * k < 1.1) { const h = Math.max(r, 0.6 * px); ctx.rect(x[v] - h, y[v] - h, 2 * h, 2 * h) }
        else { ctx.moveTo(x[v] + r, y[v]); ctx.arc(x[v], y[v], r, 0, 6.2832) }
      }
      if (lv >= 0) ctx.fill()
    }

    // 5. hovered orbit: the path this state follows into (and once around) its cycle
    if (hover >= 0) {
      const seen = S.seen
      seen.fill(0)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(2 * px, 1.4)
      ctx.beginPath()
      for (let v = hover; v >= 0 && !seen[v]; v = succ[v]) {
        seen[v] = 1
        const a = edgeOff[v], b = edgeOff[v + 1]
        if (a === b) continue
        ctx.moveTo(edgePts[2 * a], edgePts[2 * a + 1])
        for (let i = a + 1; i < b; i++) ctx.lineTo(edgePts[2 * i], edgePts[2 * i + 1])
      }
      ctx.stroke()
      const v = hover, r = Math.max((onRing[v] ? R_CYCLE : R_TREE) + 1.6, 5 * px)
      ctx.lineWidth = Math.max(2 * px, 0.9)
      ctx.beginPath()
      ctx.arc(x[v], y[v], r, 0, 6.2832)
      ctx.fillStyle = PALETTE[slots[g.comp[v]]].node[level[v]]
      ctx.fill()
      ctx.stroke()
    }
  }

  function pick(mx, my) {
    const g = S.graph, G = S.grid
    if (!g) return -1
    const wx = (mx - S.tx) / S.k, wy = (my - S.ty) / S.k
    const rad = Math.max(12 / S.k, 4)
    const span = Math.min(2, Math.ceil(rad / G.cell))
    const cx = Math.floor((wx - G.minX) / G.cell), cy = Math.floor((wy - G.minY) / G.cell)
    let best = -1, bd = rad * rad
    for (let j = Math.max(0, cy - span); j <= Math.min(G.rows - 1, cy + span); j++)
      for (let i = Math.max(0, cx - span); i <= Math.min(G.cols - 1, cx + span); i++) {
        const c = i + j * G.cols
        for (let q = G.off[c], e = G.off[c + 1]; q < e; q++) {
          const v = G.items[q], d = (g.x[v] - wx) ** 2 + (g.y[v] - wy) ** 2
          if (d < bd) { bd = d; best = v }
        }
      }
    return best
  }

  function describe(v) {
    const g = S.graph, C = g.comps || 1, n = g.dims * C
    const tuple = (i) => `(${Array.from({ length: g.dims }, (_, j) => fmtValue(Array.from(g.coords.subarray(i * n + j * C, i * n + j * C + C)))).join(', ')})`
    const c = g.comp[v], p = g.succ[v], d = g.depth[v], len = g.compRing[c]
    const closed = g.compClosed[c] === 1
    return {
      from: tuple(v),
      to: p >= 0 ? tuple(p) : null,
      where: !closed
        ? 'Its cycle lies outside this view'
        : d === 0
          ? len === 1 ? 'Fixed point' : `On a cycle of length ${len.toLocaleString()}`
          : `${d.toLocaleString()} step${d === 1 ? '' : 's'} from a ${len === 1 ? 'fixed point' : `cycle of length ${len.toLocaleString()}`}`,
      basin: g.compSize[c],
      eden: (g.flags[v] & 2) !== 0,
      color: PALETTE[S.slots[c]].node[g.level[v]],
    }
  }

  // New graph: rebuild lookup structures and refit.
  useEffect(() => {
    S.graph = graph
    S.hover = -1
    S.pinned = -1
    setTip(null)
    if (graph) {
      const nc = graph.compR.length
      S.compStart = new Uint32Array(nc + 1)
      for (let c = 0; c < nc; c++) S.compStart[c + 1] = S.compStart[c] + graph.compSize[c]
      S.vis = new Uint8Array(nc)
      S.seen = new Uint8Array(graph.m)
      S.grid = buildGrid(graph)
      S.slots = slots
      fit()
    }
    schedule()
  }, [graph])
  useEffect(() => { S.slots = slots; schedule() }, [slots])

  useEffect(() => {
    const wrap = wrapRef.current, cv = canvasRef.current
    const ro = new ResizeObserver(() => {
      const first = !S.w
      S.w = wrap.clientWidth; S.h = wrap.clientHeight; S.dpr = window.devicePixelRatio || 1
      cv.width = Math.round(S.w * S.dpr); cv.height = Math.round(S.h * S.dpr)
      if (first) fit()
      draw()
    })
    ro.observe(wrap)

    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    const onWheel = (e) => {
      e.preventDefault()
      const [mx, my] = pos(e)
      zoomAt(mx, my, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)))
    }
    const ptrs = new Map()
    let pinch = 0, moved = false
    const setHover = (v, mx, my) => {
      if (v !== S.hover) {
        S.hover = v
        // leaving a node falls back to the searched (pinned) one, if any
        setTip(v >= 0 ? describe(v) : S.pinned >= 0 ? describe(S.pinned) : null)
        schedule()
      }
      if (v >= 0) placeTip(mx, my)
    }
    const onDown = (e) => {
      cv.setPointerCapture(e.pointerId)
      ptrs.set(e.pointerId, pos(e))
      moved = false
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]) }
    }
    const onMove = (e) => {
      const p = pos(e), prev = ptrs.get(e.pointerId)
      if (!prev) { setHover(pick(p[0], p[1]), p[0], p[1]); return }
      ptrs.set(e.pointerId, p)
      if (ptrs.size === 1) {
        S.tx += p[0] - prev[0]; S.ty += p[1] - prev[1]
        if (!moved) { moved = true; cv.style.cursor = 'grabbing'; setHover(-1) }
        schedule()
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1])
        if (pinch > 0) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch)
        pinch = d
      }
    }
    const onUp = (e) => { ptrs.delete(e.pointerId); pinch = 0; cv.style.cursor = 'grab' }
    const onLeave = () => { if (!ptrs.size) setHover(-1) }
    const onDbl = (e) => { const [mx, my] = pos(e); zoomAt(mx, my, e.shiftKey ? 0.5 : 2) }
    cv.addEventListener('wheel', onWheel, { passive: false })
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('dblclick', onDbl)
    return () => {
      ro.disconnect()
      cv.removeEventListener('wheel', onWheel)
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
      cv.removeEventListener('pointerleave', onLeave)
      cv.removeEventListener('dblclick', onDbl)
      cancelAnimationFrame(S.raf); S.raf = 0
    }
  }, [])

  const vars = VAR_NAMES.slice(0, graph?.dims ?? 2).join(', ')
  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" style={{ cursor: 'grab' }} />
      <div
        ref={tipRef}
        className={`pointer-events-none absolute left-0 top-0 w-max max-w-[260px] rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur ${tip ? '' : 'hidden'}`}
      >
        {tip && (
          <>
            <div className="flex items-center gap-2 font-mono text-[13px] text-ink">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tip.color }} />
              <span>{tip.from}</span>
              <span className="text-ink-3">→</span>
              <span>{tip.to ?? '…'}</span>
            </div>
            <div className="mt-1.5 text-ink-2">{tip.where}</div>
            <div className="mt-0.5 text-ink-3">
              {tip.eden ? `No (${vars}) maps here · ` : ''}
              {tip.basin.toLocaleString()} state{tip.basin === 1 ? '' : 's'} of this basin shown
            </div>
          </>
        )}
      </div>
    </div>
  )
}
