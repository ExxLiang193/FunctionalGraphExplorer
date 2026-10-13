// Categorical slots (dark-surface steps), assigned in this fixed order and never cycled:
// cycle lengths beyond the eighth fold into "other".
export const SURFACE = '#1a1a19'
const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const OTHER = '#8f8e85' // closed cycles whose length has no slot
const OPEN = '#6b6a64' // orbit whose cycle is not in view
export const OTHER_SLOT = 8
export const OPEN_SLOT = 9
export const LEVELS = 6

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => {
  const p = hex(a), q = hex(b)
  return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`
}

// Distance to the cycle fades the hue toward the surface; cycle states get the brightest step.
const FADE = [0, 0.06, 0.2, 0.33, 0.45, 0.56]
export const PALETTE = [...SLOTS, OTHER, OPEN].map((base) => ({
  base,
  node: FADE.map((t, i) => (i === 0 ? mix(base, '#ffffff', 0.28) : mix(base, SURFACE, t))),
  edge: mix(base, SURFACE, 0.62),
  ring: mix(base, '#ffffff', 0.1),
}))

/** Picks which cycle lengths own a slot: the eight covering the most cyclic states, in ascending length. */
export function assignSlots(census) {
  const top = [...census].sort((a, b) => b[0] * b[1] - a[0] * a[1]).slice(0, SLOTS.length)
  top.sort((a, b) => a[0] - b[0])
  return new Map(top.map(([len], i) => [len, i]))
}
