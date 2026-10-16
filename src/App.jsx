import { useEffect, useMemo, useRef, useState } from 'react'
import GraphCanvas from './GraphCanvas.jsx'
import { VAR_NAMES } from './engine/parser.js'
import { randomConfig } from './engine/random.js'
import { composeImage, saveImage } from './exportImage.js'
import ExamplesMenu from './ExamplesMenu.jsx'
import { findExample } from './examples.js'
import { PALETTE, OTHER_SLOT, OPEN_SLOT, assignSlots } from './palette.js'

const DEFAULTS = {
  1: ['a^2 + 1'],
  2: ['b', 'a^2 + b'],
  3: ['b', 'c', 'a*b + c'],
  4: ['b', 'c', 'd', 'a*b + c*d'],
  5: ['b', 'c', 'd', 'e', 'a*b + c*d + e'],
}
// number systems: C integer components per variable, and how many variables fit under the state limit
const FIELDS = [
  { value: 'int', label: 'ℤ', C: 1, maxDims: 5, maxDigits: 5, title: 'Integers' },
  { value: 'complex', label: 'ℂ', C: 2, maxDims: 2, maxDigits: 2, title: 'Complex numbers: each variable is x + yi' },
  { value: 'quat', label: 'ℍ', C: 4, maxDims: 1, maxDigits: 1, title: 'Quaternions: one variable w + xi + yj + zk' },
]
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.value, f]))
const FIELD_SYNTAX = {
  complex: ['+ − * ^n', 'i', 'conj re im norm'],
  quat: ['+ − * ^n', 'i j k', 'conj re im norm', 'a*b ≠ b*a'],
}
const NO_MODS = ['', '', '', '', '']
// "mod 100" when every variable shares a modulus, otherwise "mod (100, 99)"
const modText = (cfg) => {
  const base = cfg.modulus ?? 10 ** cfg.digits
  const pv = Array.from({ length: cfg.dims }, (_, j) => cfg.moduli?.[j] ?? base)
  return pv.every((p) => p === pv[0]) ? `mod ${pv[0].toLocaleString()}` : `mod (${pv.map((p) => p.toLocaleString()).join(', ')})`
}
const SYNTAX = [
  '+ − * / ^ mod',
  '< <= > >= = !=',
  'if(test, x, y)',
  'abs min max gcd lcm sign isqrt log2',
  'digitsum digitprod digit(x, i) digits reverse concat asc desc',
  'sigma phi spf isprime',
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
  const [modulus, setModulus] = useState('') // custom modulus as typed; empty = use 10^digits
  const [perMod, setPerMod] = useState(NO_MODS) // per-variable overrides as typed; empty = the modulus above
  const [field, setField] = useState('int')
  const [negative, setNegative] = useState(false)
  const [byDims, setByDims] = useState(DEFAULTS)
  const [nonce, setNonce] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  // The graph only recomputes from `applied`, which changes on Submit (or Enter in a formula).
  const [limit, setLimit] = useState(10000)
  const [applied, setApplied] = useState({ dims: 2, digits: 2, modulus: null, moduli: [null, null], field: 'int', negative: false, limit: 10000, formulas: DEFAULTS[2] })
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
        `${FIELD[drawn.field ?? 'int'].label}${SUP[drawn.dims]}`,
        drawn.modulus || drawn.moduli?.some((x) => x) ? modText(drawn) : `${drawn.digits} digit${drawn.digits > 1 ? 's' : ''}`,
        drawn.negative ? 'negatives allowed' : 'non-negative',
        `${formatCount(drawn.stats.totalStates)} states${drawn.stats.truncated ? `, ${drawn.stats.shown.toLocaleString()} shown` : ''}`,
        ...(drawn.stats.cycles != null ? [`${drawn.stats.cycles.toLocaleString()} cycle${drawn.stats.cycles === 1 ? '' : 's'}`] : []),
      ].join('  ·  '),
      legend: legend.map((l) => ({ color: l.color, label: l.label ?? (l.len === 1 ? '1 (fixed point)' : l.len.toLocaleString()), count: l.count })),
    }
    const slug = drawn.formulas.join('_').replace(/\s+/g, '').replace(/[^A-Za-z0-9^+()=,_-]/g, '-').slice(0, 60)
    // short random suffix so two saves of the same formula never share a name
    const uid = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
    saveImage(() => composeImage(canvasRef.current.snapshot(scale), scale, info), `graph_${slug}_${uid}.png`).catch((e) => setError({ message: `Could not save image: ${e.message}`, formulaIndex: null }))
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyS' && e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); saveRef.current() }
      // F fits the graph to the screen, unless the key is being typed into a field
      else if (e.code === 'KeyF' && !e.altKey && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); canvasRef.current?.fit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mod = modulus.trim() === '' ? null : Number(modulus)
  const modBad = mod !== null && !(Number.isInteger(mod) && mod >= 2 && mod <= MAX_STATES)
  const P = mod !== null && !modBad ? mod : 10 ** digits
  // per-variable moduli: an override where one is typed and valid, otherwise the shared P
  const perParsed = perMod.slice(0, dims).map((t) => (t.trim() === '' ? null : Number(t)))
  const perBad = perParsed.map((v) => v !== null && !(Number.isInteger(v) && v >= 2 && v <= MAX_STATES))
  const moduli = perParsed.map((v, j) => (v !== null && !perBad[j] ? v : null))
  const Pv = moduli.map((v) => v ?? P)
  const anyBad = modBad || perBad.some(Boolean)
  const C = FIELD[field].C
  const known = findExample({ dims, digits, modulus: modBad ? null : mod, moduli, field, negative, formulas })
  const dirty = dims !== applied.dims || (mod === null && digits !== applied.digits) || mod !== applied.modulus || field !== applied.field ||
    moduli.some((v, j) => v !== (applied.moduli?.[j] ?? null)) || negative !== applied.negative || limit !== applied.limit || formulas.some((f, i) => f !== applied.formulas[i])
  const stateCount = Pv.reduce((n, p) => n * BigInt(negative ? 2 * p - 1 : p) ** BigInt(C), 1n)
  const tooBig = stateCount > BigInt(MAX_STATES)
  const submit = (e) => { e.preventDefault(); if (dirty && !tooBig && !anyBad) { setError(null); setApplied({ dims, digits, modulus: mod, moduli, field, negative, limit, formulas }) } }
  const changeField = (f) => { setField(f); setDims((d) => Math.min(d, FIELD[f].maxDims)); setDigits((d) => Math.min(d, FIELD[f].maxDigits)) }
  const randomize = () => {
    const r = randomConfig(MAX_STATES, Math.random, field) // stays in the current number system
    setDims(r.dims); setDigits(r.digits); setModulus(r.modulus ? String(r.modulus) : ''); setPerMod(NO_MODS); setNegative(r.negative)
    setByDims((m) => ({ ...m, [r.dims]: r.formulas }))
  }
  const loadExample = (ex) => {
    setField(ex.field ?? 'int'); setDims(ex.dims); setDigits(ex.digits); setModulus(ex.modulus ? String(ex.modulus) : '')
    setPerMod(NO_MODS.map((_, j) => (ex.moduli?.[j] ? String(ex.moduli[j]) : '')))
    setNegative(!!ex.negative); setLimit(ex.limit ?? 10000)
    setByDims((m) => ({ ...m, [ex.dims]: ex.f }))
  }
  // Typing in one variable's mod box switches to per-variable moduli: the other boxes are filled with
  // the modulus they were inheriting, and the shared Digits / modulus setting is cleared. Picking Digits
  // or typing a shared modulus switches back and empties every per-variable box.
  const perMode = perMod.slice(0, dims).some((t) => t.trim() !== '')
  const setVarModulus = (i, raw) => {
    const v = raw.replace(/[^0-9]/g, '')
    setPerMod((m) => m.map((x, j) => (j === i ? v : !perMode && j < dims ? String(P) : x)))
    if (!perMode) setModulus('')
  }
  const setFormula = (i, v) => setByDims((m) => ({ ...m, [dims]: m[dims].map((f, j) => (j === i ? v : f)) }))
  const stats = result?.stats
  const rangeOf = (p) => (negative ? `[−${p - 1}, ${p - 1}]` : `[0, ${p - 1}]`)
  const subject = C > 1 ? `each component of ${vars.join(', ')}` : vars.join(', ')
  const rangeHint = Pv.every((p) => p === Pv[0])
    ? `${subject} ∈ ${rangeOf(Pv[0])} · ${negative ? `results keep their sign; the size wraps mod ${Pv[0].toLocaleString()}` : `results wrap mod ${Pv[0].toLocaleString()}`}`
    : `${vars.map((v, j) => `${v} ∈ ${rangeOf(Pv[j])}`).join(' · ')} · each result wraps at its own variable's modulus`

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
            <span className="text-ink-3"> {modText(applied)}{applied.negative ? ' ±' : ''}{applied.field && applied.field !== 'int' ? ` · ${FIELD[applied.field].label}` : ''}</span>
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
              <span className="text-[11px] text-ink-3">mod</span>
              <input
                value={perMod[i]}
                onChange={(e) => setVarModulus(i, e.target.value)}
                inputMode="numeric"
                placeholder={P.toLocaleString()}
                aria-label={`Modulus for ${vars[i]}`}
                aria-invalid={perBad[i]}
                title={`Modulus for ${vars[i]} only; leave empty to use the shared one`}
                style={{ width: `${Math.max(4, (perMod[i] || P.toLocaleString()).length + 2)}ch` }}
                className={`select-text rounded-md border bg-surface px-1.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3/70 focus:border-[#3987e5] ${perBad[i] ? 'border-[#e66767]' : 'border-line/60'}`}
              />
              {i < formulas.length - 1 && <span className="text-ink-3">,</span>}
            </span>
          ))}
          <span className="text-ink-3">)</span>
        </div>
        {known && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3987e5]" />
            Known example: <span className="text-ink-2">{known.example.name}</span>
            {!known.exact && <span>(with different settings)</span>}
          </div>
        )}
        {error && <div className="mt-2 text-xs text-[#e66767]">{error.message}</div>}

        {/* space */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
          <label className="flex items-center gap-2">
            Space
            <Segmented label="Number system" value={field} onChange={changeField} options={FIELDS.map((f) => ({ value: f.value, label: f.label }))} />
            <Segmented
              label="Dimensions"
              value={dims}
              onChange={setDims}
              options={Array.from({ length: FIELD[field].maxDims }, (_, i) => ({ value: i + 1, label: `${FIELD[field].label}${SUP[i + 1]}` }))}
            />
          </label>
        </div>
        {/* range of values */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
          <label className="flex items-center gap-2">
            Digits
            <Segmented label="Digits" value={mod === null && !perMode ? digits : null} onChange={(d) => { setDigits(d); setModulus(''); setPerMod(NO_MODS) }} options={Array.from({ length: FIELD[field].maxDigits }, (_, i) => ({ value: i + 1, label: i + 1 }))} />
          </label>
          <label className="flex items-center gap-2" title="Wrap at any modulus instead of a power of ten, e.g. a prime like 997 or a power of two like 4096">
            or modulus
            <input
              value={modulus}
              onChange={(e) => { setModulus(e.target.value.replace(/[^0-9]/g, '')); setPerMod(NO_MODS) }}
              inputMode="numeric"
              placeholder={perMode ? '' : (10 ** digits).toLocaleString()}
              aria-label="Custom modulus"
              aria-invalid={modBad}
              className={`w-20 select-text rounded-md border bg-surface px-2 py-1 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-[#3987e5] ${modBad ? 'border-[#e66767]' : 'border-line'}`}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-ink">
            <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} className="h-3.5 w-3.5 accent-[#3987e5]" />
            Allow negative
          </label>
        </div>
        {/* what the range means */}
        <div className="mt-2 text-[11px] text-ink-3">
          {rangeHint}
        </div>
        {/* view */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
          <label className="flex items-center gap-2" title="Largest number of states drawn; bigger spaces are sampled">
            Sample limit
            <Segmented label="Sample state limit" value={limit} onChange={setLimit} options={[10000, 50000, 100000].map((n) => ({ value: n, label: `${n / 1000}k` }))} />
          </label>
        </div>
        {/* available syntax */}
        <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[11px] text-ink-3">
          {(FIELD_SYNTAX[field] ?? SYNTAX).map((t) => (
            <span key={t} className="rounded bg-white/5 px-1.5 py-0.5">{t}</span>
          ))}
        </div>
        <div className="mt-3.5 flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || tooBig || anyBad}
            className="rounded-md bg-[#3987e5] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#4f96ea] disabled:cursor-default disabled:bg-white/10 disabled:text-ink-3"
          >
            Submit
          </button>
          <button
            type="button"
            onClick={randomize}
            aria-label="Randomize"
            title="Randomize: fill in a random space and random formulas (in the current number system)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
              {[[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill="currentColor" stroke="none" />
              ))}
            </svg>
          </button>
          <ExamplesMenu onPick={loadExample} />
          {anyBad ? (
            <span className="text-[11px] text-[#e66767]">Moduli must be whole numbers from 2 to {MAX_STATES.toLocaleString()}.</span>
          ) : tooBig ? (
            <span className="text-[11px] text-[#e66767]">
              {formatCount(stateCount)} states is over the {MAX_STATES.toLocaleString()} limit. Lower the digits, modulus or dimension.
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

      {/* credit */}
      <a
        href="https://github.com/ExxLiang193/FunctionalGraphExplorer"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-ink-3/70 transition-colors hover:text-ink-2 max-md:hidden"
      >
        Functional Graph Explorer · by ExxLiang193
      </a>

      {/* view controls */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 text-xs">
        {result && <StateSearch params={result.params} canvasRef={canvasRef} />}
        <div className="flex items-center gap-2">
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
            ['Fit', 'Fit to screen (F)', () => canvasRef.current.fit()],
          ].map(([t, label, fn]) => (
            <button key={t} onClick={fn} aria-label={label} title={label} className="min-w-9 border-l border-line px-3 py-2 text-ink-2 transition-colors first:border-l-0 hover:bg-white/10 hover:text-ink">
              {t}
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}

/** Bottom-right search: type a state's components and the graph highlights it like a hover. */
function StateSearch({ params, canvasRef }) {
  const field = FIELD[params.field ?? 'int'], C = field.C, dims = params.dims
  const names = VAR_NAMES.slice(0, dims)
  const [vals, setVals] = useState(() => Array(dims * C).fill(''))
  const [msg, setMsg] = useState(null)
  const [found, setFound] = useState(false)
  // a new configuration resets the search
  useEffect(() => { setVals(Array(dims * C).fill('')); setMsg(null); setFound(false) }, [params, dims, C])

  const clear = () => { setVals(Array(dims * C).fill('')); setMsg(null); setFound(false); canvasRef.current?.clearFocus() }
  const MISS = 'Not in sample. Try different values.'
  const search = (e) => {
    e.preventDefault()
    const nums = vals.map((v) => (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN))
    const v = nums.some(Number.isNaN) ? -1 : canvasRef.current?.find(nums) ?? -1
    if (v < 0) { setFound(false); canvasRef.current?.clearFocus(); return setMsg(MISS) }
    setMsg(null); setFound(true)
    canvasRef.current.focus(v)
  }
  const box = (k) => (
    <input
      key={k}
      value={vals[k]}
      onChange={(e) => setVals((a) => a.map((x, i) => (i === k ? e.target.value.replace(/[^0-9-]/g, '') : x)))}
      inputMode="numeric"
      aria-label={`${names[Math.floor(k / C)]}${C > 1 ? ` component ${k % C + 1}` : ''}`}
      className="w-11 select-text rounded border border-line bg-surface px-1.5 py-1 text-center font-mono text-[11px] text-ink outline-none focus:border-[#3987e5]"
    />
  )
  const unit = ['', 'i', 'j', 'k']
  return (
    <form onSubmit={search} className={`flex max-w-[calc(100vw-2rem)] flex-col items-end gap-1.5 px-2.5 py-2 ${panel}`}>
      <div className="flex flex-wrap items-center justify-end gap-1 font-mono text-[11px] text-ink-3">
        <span className="mr-1 font-sans text-ink-2">Find</span>(
        {names.map((nm, j) => (
          <span key={nm} className="flex items-center gap-1">
            {Array.from({ length: C }, (_, c) => (
              <span key={c} className="flex items-center gap-0.5">
                {c > 0 && <span>+</span>}
                {box(j * C + c)}
                {unit[c] && <span>{unit[c]}</span>}
              </span>
            ))}
            {j < dims - 1 && <span>,</span>}
          </span>
        ))}
        )
        <button type="submit" aria-label="Find state" title="Find and highlight this state (Enter)" className="ml-1 rounded px-1.5 py-1 text-ink-2 transition-colors hover:bg-white/10 hover:text-ink">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" strokeLinecap="round" /></svg>
        </button>
        {(found || msg || vals.some((v) => v !== '')) && (
          <button type="button" onClick={clear} aria-label="Clear search" title="Clear search" className="rounded px-1.5 py-1 text-ink-3 transition-colors hover:bg-white/10 hover:text-ink">
            ×
          </button>
        )}
      </div>
      {msg && <div className="max-w-72 text-right text-[11px] text-[#e66767]">{msg}</div>}
    </form>
  )
}
