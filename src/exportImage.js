// Composes the saved image: the graph exactly as currently framed, with the formula in a band
// above it and the legend in a band below, so neither covers the drawing.
import { PALETTE, SURFACE } from './palette.js'

const INK = '#ffffff', INK2 = '#c3c2b7', INK3 = '#8f8e85', LINE = '#3a3a37'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * @param graphCanvas canvas holding the rendered graph
 * @param scale       device pixels per CSS pixel used for graphCanvas
 * @param info        { head: string, parts: string[], tail: string, meta: string, legend: [{color, label, count}] }
 */
export function composeImage(graphCanvas, scale, info) {
  const W = graphCanvas.width, u = scale
  const pad = 24 * u, inner = W - 2 * pad
  const m = document.createElement('canvas').getContext('2d')

  // header: formula, wrapped between components
  const fFont = `${17 * u}px ${MONO}`, fLine = 26 * u
  m.font = fFont
  const lines = [info.head]
  info.parts.forEach((p, i) => {
    const piece = p + (i < info.parts.length - 1 ? ', ' : info.tail)
    const cur = lines[lines.length - 1]
    if (m.measureText(cur + piece).width > inner && cur !== info.head) lines.push('    ' + piece)
    else lines[lines.length - 1] = cur + piece
  })
  const headH = pad + lines.length * fLine + 22 * u + pad * 0.75

  // footer: legend entries flow left to right, then the distance ramp
  const lFont = `${13 * u}px ${SANS}`, lLine = 22 * u, dot = 10 * u, gap = 22 * u
  m.font = lFont
  const title = 'Cycle length'
  const items = info.legend.map((l) => {
    const count = l.count == null ? '' : `  ×${l.count.toLocaleString()}`
    return { ...l, count, w: dot + 7 * u + m.measureText(l.label).width + m.measureText(count).width }
  })
  let x = m.measureText(title).width + gap, rows = 1
  for (const it of items) {
    if (x + it.w > inner && x > 0) { rows++; x = 0 }
    it.x = x; it.row = rows - 1
    x += it.w + gap
  }
  const rampW = Math.min(220 * u, inner)
  const footH = pad * 0.75 + rows * lLine + 30 * u + pad

  const out = document.createElement('canvas')
  out.width = W; out.height = Math.round(headH + graphCanvas.height + footH)
  const c = out.getContext('2d')
  c.fillStyle = SURFACE
  c.fillRect(0, 0, out.width, out.height)
  c.textBaseline = 'middle'

  c.font = fFont; c.fillStyle = INK
  lines.forEach((t, i) => c.fillText(t, pad, pad + fLine * (i + 0.5)))
  c.font = `${13 * u}px ${SANS}`; c.fillStyle = INK3
  c.fillText(info.meta, pad, pad + lines.length * fLine + 11 * u)

  c.drawImage(graphCanvas, 0, Math.round(headH))
  c.fillStyle = LINE
  c.fillRect(0, Math.round(headH) - u, W, u)
  c.fillRect(0, Math.round(headH) + graphCanvas.height, W, u)

  const fy = headH + graphCanvas.height + pad * 0.75
  c.font = lFont
  c.fillStyle = INK3
  c.fillText(title, pad, fy + lLine / 2)
  for (const it of items) {
    const y = fy + it.row * lLine + lLine / 2
    let ix = pad + it.x
    c.fillStyle = it.color
    c.beginPath(); c.arc(ix + dot / 2, y, dot / 2, 0, 6.2832); c.fill()
    ix += dot + 7 * u
    c.fillStyle = INK2; c.fillText(it.label, ix, y)
    c.fillStyle = INK3; c.fillText(it.count, ix + c.measureText(it.label).width, y)
  }
  const ry = fy + rows * lLine + 8 * u
  const grad = c.createLinearGradient(pad, 0, pad + rampW, 0)
  PALETTE[0].node.forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col))
  c.fillStyle = grad
  c.beginPath(); c.roundRect(pad, ry, rampW, 6 * u, 3 * u); c.fill()
  c.fillStyle = INK3
  c.fillText('on cycle', pad, ry + 17 * u)
  c.textAlign = 'right'
  c.fillText('far from it', pad + rampW, ry + 17 * u)
  return out
}

/** Asks where to save (native dialog where the browser has one), then writes the PNG. */
export async function saveImage(makeCanvas, suggestedName) {
  let handle = null
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }] })
    } catch (e) {
      if (e.name === 'AbortError') return false // dialog dismissed
    }
  }
  const blob = await new Promise((res) => makeCanvas().toBlob(res, 'image/png'))
  if (handle) {
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
  } else {
    // no file picker in this browser: fall back to a normal download
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = suggestedName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  }
  return true
}
