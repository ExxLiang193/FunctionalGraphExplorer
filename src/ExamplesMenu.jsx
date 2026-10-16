import { useEffect, useMemo, useRef, useState } from 'react'
import { EXAMPLES } from './examples.js'

const SUP = ['', '', '²', '³', '⁴', '⁵']
const SYM = { int: 'ℤ', complex: 'ℂ', quat: 'ℍ' }
const ORDER = ['int', 'complex', 'quat']
const tags = (ex) => [
  ex.moduli ? `mod ${ex.moduli.join(', ')}` : ex.modulus ? `mod ${ex.modulus.toLocaleString()}` : `${ex.digits} digit${ex.digits > 1 ? 's' : ''}`,
  ...(ex.negative ? ['negatives'] : []),
  ...(ex.limit ? [`${ex.limit / 1000}k`] : []),
].join(' · ')

/** Two-level dropdown: spaces on the first level, that space's examples (name + formulas) on the second. */
export default function ExamplesMenu({ onPick }) {
  const [open, setOpen] = useState(false)
  const [space, setSpace] = useState(null)
  const root = useRef(null)
  const groups = useMemo(() => {
    const m = new Map()
    // group key: number system and dimension, e.g. 'complex:2'
    for (const ex of EXAMPLES) { const k = `${ex.field ?? 'int'}:${ex.dims}`; m.set(k, [...(m.get(k) || []), ex]) }
    const rank = (k) => { const [f, d] = k.split(':'); return ORDER.indexOf(f) * 10 + Number(d) }
    return [...m].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!root.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const item = 'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors'
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setSpace(null) }}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:border-ink-3 hover:text-ink ${open ? 'border-ink-3 text-ink' : 'border-line text-ink-2'}`}
      >
        Examples <span className="text-[9px] text-ink-3">▼</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 mt-1.5 w-36 rounded-lg border border-line bg-panel py-1 text-xs shadow-2xl shadow-black/50">
          {groups.map(([dims, list]) => (
            <div key={dims} onPointerEnter={(e) => e.pointerType === 'mouse' && setSpace(dims)}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={space === dims}
                onClick={() => setSpace(dims)}
                className={`${item} ${space === dims ? 'bg-white/10 text-ink' : 'text-ink-2'}`}
              >
                <span className="font-mono text-[13px]">{SYM[dims.split(':')[0]]}{SUP[dims.split(':')[1]]}</span>
                <span className="text-ink-3">{list.length} ▸</span>
              </button>
              {space === dims && (
                <div role="menu" className="absolute left-full top-0 ml-1 max-h-[min(70vh,560px)] w-[min(420px,calc(100vw-13rem))] overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-2xl shadow-black/50">
                  {list.map((ex) => (
                    <button
                      key={ex.name}
                      type="button"
                      role="menuitem"
                      title={ex.f.join(',  ')}
                      onClick={() => { onPick(ex); setOpen(false) }}
                      className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-white/10"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-ink">{ex.name}</span>
                        <span className="shrink-0 text-[10px] text-ink-3">{tags(ex)}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-3">{ex.f.join(',  ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
