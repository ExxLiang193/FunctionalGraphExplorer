import { useEffect, useMemo, useRef, useState } from 'react'
import GraphCanvas from './GraphCanvas.jsx'
import { VAR_NAMES } from './engine/parser.js'
import { randomConfig } from './engine/random.js'
import { composeImage, saveImage } from './exportImage.js'
import { PALETTE, OTHER_SLOT, OPEN_SLOT, assignSlots } from './palette.js'

const DEFAULTS = {
  1: ['a^2 + 1'],
  2: ['b', 'a^2 + b'],
  3: ['b', 'c', 'a*b + c'],
  4: ['b', 'c', 'd', 'a*b + c*d'],
  5: ['b', 'c', 'd', 'e', 'a*b + c*d + e'],
}
const EXAMPLES = [
  { name: 'Fibonacci', dims: 2, digits: 2, f: ['b', 'a + b'] },
  { name: 'Quadratic', dims: 2, digits: 2, f: ['b', 'a^2 + b'] },
  { name: 'Digit append', dims: 2, digits: 1, f: ['if(a+b < 10, b, 1)', '(a+b) mod 10'] },
  { name: 'Collatz', dims: 1, digits: 3, f: ['if(a mod 2 = 0, a/2, 3a + 1)'] },
  { name: 'Kaprekar', dims: 1, digits: 4, f: ['desc(a) - asc(a)'] },
  { name: 'Ducci', dims: 4, digits: 1, f: ['abs(a-b)', 'abs(b-c)', 'abs(c-d)', 'abs(d-a)'] },
  { name: 'Euclid', dims: 2, digits: 2, f: ['abs(a-b)', 'min(a, b)'] },
  { name: 'Xorshift', dims: 1, digits: 4, f: ['a xor (a << 3) xor (a >> 2)'] },
]
const SYNTAX = [
  '+ − * / ^ mod',
  '< <= > >= = !=',
  'if(test, x, y)',
  'abs min max gcd',
  'digitsum reverse digits concat asc desc',
  'and or xor << >>',
]
const MAX_STATES = 1_000_000 // largest space the form will submit
const SUP = ['', '', '²', '³', '⁴', '⁵']
const sup = (n) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])

function formatCount(s) {
  s = String(s)
  if (s.length <= 12) return Number(s).toLocaleString()
  return `${s[0]}.${s.slice(1, 3)} × 10${sup(s.length - 1)}`
}
const pct = (a, b) => { const p = (100 * a) / b; return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toPrecision(1)}%` }

function Segmented({ value, options, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-w-7 rounded px-2 py-1 text-xs tabular-nums transition-colors ${
            o.value === value ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-white/10 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const panel = 'rounded-xl border border-line bg-panel/90 shadow-2xl shadow-black/40 backdrop-blur-md'

export default function App() {
  const [dims, setDims] = useState(2)
  const [digits, setDigits] = useState(2)
  const [negative, setNegative] = useState(false)
  const [byDims, setByDims] = useState(DEFAULTS)
  const [nonce, setNonce] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  // The graph only recomputes from `applied`, which changes on Submit (or Enter in a formula).
  const [limit, setLimit] = useState(10000)
  const [applied, setApplied] = useState({ dims: 2, digits: 2, negative: false, limit: 10000, formulas: DEFAULTS[2] })
  const [result, setResult] = useState(null) // { graph, stats }
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const canvasRef = useRef(null)
  const formulas = byDims[dims]
  const vars = VAR_NAMES.slice(0, dims)

  // Recompute off the main thread; a newer request simply kills the running worker.
  useEffect(() => {
    let worker
    const timer = setTimeout(() => {
      worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' })
      setProgress(0)
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') return setProgress(data.p)
        setProgress(null)
        if (data.type === 'done') { setError(null); setResult({ graph: data.graph, stats: data.stats, params: applied }) }
        else setError(data)
        worker.terminate()
      }
      worker.onerror = (e) => { setProgress(null); setError({ message: e.message || 'Computation failed', formulaIndex: null }) }
      worker.postMessage(applied)
    }, 0)
    return () => { clearTimeout(timer); worker?.terminate() }
  }, [applied, nonce])

  // Colour: hue = length of the cycle a basin drains into; slots go to the lengths covering most cyclic states.
  const { slots, legend } = useMemo(() => {
    if (!result) return { slots: null, legend: [] }
    const { graph: g, stats } = result
    const nc = g.compR.length
    let census = stats.census
    if (!census) {
      const m = new Map()
      for (let c = 0; c < nc; c++) if (g.compClosed[c]) m.set(g.compRing[c], (m.get(g.compRing[c]) || 0) + 1)
      census = [...m].sort((a, b) => a[0] - b[0])
    }
    const bySlot = assignSlots(census)
    const slots = new Uint8Array(nc)
    let open = false
    for (let c = 0; c < nc; c++) {
      if (!g.compClosed[c]) { slots[c] = OPEN_SLOT; open = true }
      else slots[c] = bySlot.get(g.compRing[c]) ?? OTHER_SLOT
    }
    const legend = census.filter(([len]) => bySlot.has(len)).map(([len, count]) => ({ color: PALETTE[bySlot.get(len)].base, len, count }))
    const rest = census.filter(([len]) => !bySlot.has(len))
    if (rest.length) legend.push({ color: PALETTE[OTHER_SLOT].base, label: `${rest.length} other length${rest.length === 1 ? '' : 's'}`, count: rest.reduce((s, r) => s + r[1], 0) })
    if (open) legend.push({ color: PALETTE[OPEN_SLOT].base, label: 'Cycle outside view', count: null })
    return { slots, legend }
  }, [result])

  // Option+S (or the Save button): the current view plus formula and legend, as a PNG.
  // `drawn` is the configuration the visible graph was computed from.
  const drawn = result ? { ...result.params, stats: result.stats } : null
  const saveRef = useRef(null)
  saveRef.current = () => {
    if (!drawn || !canvasRef.current) return
    const names = VAR_NAMES.slice(0, drawn.dims)
    const scale = Math.max(2, window.devicePixelRatio || 1)
    const info = {
      head: `(${names.join(', ')}) → (`,
      parts: drawn.formulas,
      tail: ')',
      meta: [
        `ℤ${SUP[drawn.dims]}`,
        `${drawn.digits} digit${drawn.digits > 1 ? 's' : ''}`,
        drawn.negative ? 'negatives allowed' : 'non-negative',
        `${formatCount(drawn.stats.totalStates)} states${drawn.stats.truncated ? `, ${drawn.stats.shown.toLocaleString()} shown` : ''}`,
        ...(drawn.stats.cycles != null ? [`${drawn.stats.cycles.toLocaleString()} cycle${drawn.stats.cycles === 1 ? '' : 's'}`] : []),
      ].join('  ·  '),
      legend: legend.map((l) => ({ color: l.color, label: l.label ?? (l.len === 1 ? '1 (fixed point)' : l.len.toLocaleString()), count: l.count })),
    }
    const slug = drawn.formulas.join('_').replace(/\s+/g, '').replace(/[^A-Za-z0-9^+()=,_-]/g, '-').slice(0, 60)
    saveImage(() => composeImage(canvasRef.current.snapshot(scale), scale, info), `graph_${slug}.png`).catch((e) => setError({ message: `Could not save image: ${e.message}`, formulaIndex: null }))
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyS' && e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); saveRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dirty = dims !== applied.dims || digits !== applied.digits || negative !== applied.negative || limit !== applied.limit || formulas.some((f, i) => f !== applied.formulas[i])
  const stateCount = BigInt(negative ? 2 * 10 ** digits - 1 : 10 ** digits) ** BigInt(dims)
  const tooBig = stateCount > BigInt(MAX_STATES)
  const submit = (e) => { e.preventDefault(); if (dirty && !tooBig) { setError(null); setApplied({ dims, digits, negative, limit, formulas }) } }
  const randomize = () => {
    const r = randomConfig(MAX_STATES)
    setDims(r.dims); setDigits(r.digits); setNegative(r.negative)
    setByDims((m) => ({ ...m, [r.dims]: r.formulas }))
  }
  const setFormula = (i, v) => setByDims((m) => ({ ...m, [dims]: m[dims].map((f, j) => (j === i ? v : f)) }))
  const stats = result?.stats
  const P = 10 ** digits
  const range = negative ? `[−${P - 1}, ${P - 1}]` : `[0, ${P - 1}]`

  let rows = [], note = null
  if (stats) {
    const N = Number(stats.totalStates)
    rows.push(['States', formatCount(stats.totalStates)])
    if (stats.truncated) rows.push(['Shown', stats.shown.toLocaleString()])
    if (stats.mode === 'exact') {
      rows.push(['Cycles', stats.cycles.toLocaleString()])
      rows.push(['Longest cycle', stats.longest.toLocaleString()])
      rows.push(['States on a cycle', `${stats.cyclic.toLocaleString()} · ${pct(stats.cyclic, N)}`])
      rows.push(['Unreachable states', `${stats.leaves.toLocaleString()} · ${pct(stats.leaves, N)}`])
      if (stats.truncated) note = `Counts cover the whole space. The view starts at a random state’s cycle and grows outward breadth-first through predecessors until ${stats.limit.toLocaleString()} states.`
    } else {
      if (stats.found) {
        rows.push(['Cycle found', `length ${stats.lambda.toLocaleString()}`])
        rows.push(['Tail before it', `${stats.mu.toLocaleString()} steps`])
      }
      note = `${stats.found ? '' : `No cycle within ${stats.maxSteps.toLocaleString()} steps of a random start. `}This space is too large to enumerate, so predecessors are unknown: the view follows a random state forward to its cycle, then adds forward orbits of other random states.`
    }
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-surface font-sans text-ink">
      <GraphCanvas ref={canvasRef} graph={result?.graph ?? null} slots={slots} />

      {progress !== null && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-white/5">
          <div className="h-full bg-[#3987e5] transition-[width] duration-150" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}

      {/* formula + controls */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          title="Show settings"
          className={`absolute left-4 top-4 flex max-w-[min(520px,calc(100vw-2rem))] items-center gap-2.5 px-3 py-2 font-mono text-xs text-ink-2 transition-colors hover:text-ink ${panel}`}
        >
          <span className="text-ink-3">▸</span>
          <span className="truncate">
            ({VAR_NAMES.slice(0, applied.dims).join(', ')}) → ({applied.formulas.join(', ')})
          </span>
          {error && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e66767]" />}
        </button>
      )}
      <form onSubmit={submit} className={`absolute left-4 top-4 max-w-[min(680px,calc(100vw-2rem))] p-4 pr-11 ${panel} ${collapsed ? 'hidden' : ''}`}>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded
          aria-label="Hide settings"
          title="Hide settings"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/10 hover:text-ink"
        >
          ▾
        </button>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 font-mono text-[15px]">
          <span className="whitespace-nowrap text-ink-2">({vars.join(', ')})</span>
          <span className="px-1 text-ink-3">→</span>
          <span className="text-ink-3">(</span>
          {formulas.map((f, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <input
                value={f}
                onChange={(e) => setFormula(i, e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-label={`Formula for next ${vars[i]}`}
                aria-invalid={!dirty && error?.formulaIndex === i}
                style={{ width: `${Math.max(7, f.length + 2)}ch` }}
                className={`select-text rounded-md border bg-surface px-2 py-1.5 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-[#3987e5] ${
                  !dirty && error?.formulaIndex === i ? 'border-[#e66767]' : 'border-line'
                }`}
              />
              {i < formulas.length - 1 && <span className="text-ink-3">,</span>}
            </span>
          ))}
          <span className="text-ink-3">)</span>
        </div>
        {error && <div className="mt-2 text-xs text-[#e66767]">{error.message}</div>}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-xs text-ink-2">
          <label className="flex items-center gap-2">
            Space
            <Segmented label="Dimensions" value={dims} onChange={setDims} options={[1, 2, 3, 4, 5].map((d) => ({ value: d, label: `ℤ${SUP[d]}` }))} />
          </label>
          <label className="flex items-center gap-2">
            Digits
            <Segmented label="Digits" value={digits} onChange={setDigits} options={[1, 2, 3, 4, 5].map((d) => ({ value: d, label: d }))} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-ink">
            <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} className="h-3.5 w-3.5 accent-[#3987e5]" />
            Allow negative
          </label>
          <label className="flex items-center gap-2" title="Largest number of states drawn; bigger spaces are sampled">
            Sample limit
            <Segmented label="Sample state limit" value={limit} onChange={setLimit} options={[10000, 50000, 100000].map((n) => ({ value: n, label: `${n / 1000}k` }))} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-3">
          <span>
            {vars.join(', ')} ∈ {range} · {negative ? `results keep their sign and last ${digits} digit${digits > 1 ? 's' : ''}` : `results wrap mod ${P.toLocaleString()}`}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-ink-3">
          {SYNTAX.map((t) => (
            <span key={t} className="rounded bg-white/5 px-1.5 py-0.5">{t}</span>
          ))}
        </div>
        {
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
            Try
            {EXAMPLES.map((ex) => (
              <button key={ex.name} type="button" onClick={() => { setDims(ex.dims); setDigits(ex.digits); setNegative(false); setByDims((m) => ({ ...m, [ex.dims]: ex.f })) }} className="rounded-full border border-line px-2 py-0.5 text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
                {ex.name}
              </button>
            ))}
          </div>
        }
        <div className="mt-3.5 flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || tooBig}
            className="rounded-md bg-[#3987e5] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#4f96ea] disabled:cursor-default disabled:bg-white/10 disabled:text-ink-3"
          >
            Submit
          </button>
          <button
            type="button"
            onClick={randomize}
            aria-label="Randomize"
            title="Randomize: fill in a random space and random formulas"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
              {[[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill="currentColor" stroke="none" />
              ))}
            </svg>
          </button>
          {tooBig ? (
            <span className="text-[11px] text-[#e66767]">
              {formatCount(stateCount)} states is over the {MAX_STATES.toLocaleString()} limit. Lower the digits or the dimension.
            </span>
          ) : (
            dirty && <span className="text-[11px] text-ink-3">Unapplied changes</span>
          )}
        </div>
      </form>

      {/* stats */}
      {stats && (
        <div className={`absolute right-4 top-4 w-64 p-4 text-xs max-md:hidden ${panel}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {note && <p className="mt-3 border-t border-line pt-3 leading-relaxed text-ink-3">{note}</p>}
        </div>
      )}

      {/* legend */}
      {legend.length > 0 && (
        <div className={`absolute bottom-4 left-4 w-60 p-4 text-xs ${panel}`}>
          <div className="mb-2 flex items-baseline justify-between text-ink-3">
            <span>Cycle length</span>
            <span>cycles</span>
          </div>
          <ul className="space-y-1">
            {legend.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                <span className="text-ink-2">{l.label ?? (l.len === 1 ? '1 · fixed point' : l.len.toLocaleString())}</span>
                <span className="ml-auto tabular-nums text-ink-3">{l.count?.toLocaleString() ?? ''}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-3 text-ink-3">
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${PALETTE[0].node.join(',')})` }} />
            </div>
            <div className="mt-1 flex justify-between">
              <span>on cycle</span>
              <span>far from it</span>
            </div>
          </div>
        </div>
      )}

      {/* view controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs">
        {stats?.truncated && (
          <button onClick={() => setNonce((n) => n + 1)} className={`px-3 py-2 text-ink-2 transition-colors hover:text-ink ${panel}`} title="Start from a different random state">
            Resample
          </button>
        )}
        {result && (
          <button onClick={() => saveRef.current()} className={`px-3 py-2 text-ink-2 transition-colors hover:text-ink ${panel}`} title="Save image with formula and legend (⌥S)">
            Save
          </button>
        )}
        <div className={`flex overflow-hidden ${panel}`}>
          {[
            ['−', 'Zoom out', () => canvasRef.current.zoom(1 / 1.5)],
            ['+', 'Zoom in', () => canvasRef.current.zoom(1.5)],
            ['Fit', 'Fit to screen', () => canvasRef.current.fit()],
          ].map(([t, label, fn]) => (
            <button key={t} onClick={fn} aria-label={label} title={label} className="min-w-9 border-l border-line px-3 py-2 text-ink-2 transition-colors first:border-l-0 hover:bg-white/10 hover:text-ink">
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
