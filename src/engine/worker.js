import { build } from './build.js'
import { layout } from './layout.js'

self.onmessage = ({ data: params }) => {
  try {
    const t0 = performance.now()
    let last = 0
    const g = build(params, (p) => {
      const now = performance.now()
      if (now - last > 60) { last = now; self.postMessage({ type: 'progress', p }) }
    })
    const L = layout(g.m, g.succ)
    g.stats.ms = performance.now() - t0
    const out = { type: 'done', graph: { m: g.m, dims: params.dims, coords: g.coords, succ: g.succ, flags: g.flags, ...L }, stats: g.stats }
    const transfer = Object.values(out.graph).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer)
    self.postMessage(out, [...new Set(transfer)])
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message, formulaIndex: e.formulaIndex ?? null })
  }
}
