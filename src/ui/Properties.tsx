import { STOCK } from '../document/catalog'
import type { Piece } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

interface DimMeta {
  label: string
  /** Bounds/step in document units (meters, or raw for counts). */
  min: number
  max: number
  step: number
  /** 'cm' shows/edits centimeters; 'int' is a raw count. */
  unit: 'cm' | 'int'
}

/** Builder-friendly names + sensible ranges for each dimension of each stock. */
function dimMeta(piece: Piece, key: string): DimMeta {
  const mech = STOCK[piece.stockType].visual != null
  switch (key) {
    case 'x':
      return { label: 'Length', min: 0.01, max: 3, step: 0.005, unit: 'cm' }
    case 'y':
      return { label: 'Height', min: 0.005, max: 3, step: 0.005, unit: 'cm' }
    case 'z':
      return { label: 'Width', min: 0.01, max: 3, step: 0.005, unit: 'cm' }
    case 'radius':
      return { label: 'Radius', min: 0.005, max: 0.5, step: 0.0025, unit: 'cm' }
    case 'height':
      return mech
        ? { label: 'Thickness', min: 0.005, max: 0.12, step: 0.0025, unit: 'cm' }
        : { label: 'Length', min: 0.02, max: 3, step: 0.005, unit: 'cm' }
    case 'teeth':
      return { label: 'Teeth', min: 4, max: 48, step: 1, unit: 'int' }
    case 'lobe':
      return { label: 'Lobe offset', min: 0.005, max: 0.06, step: 0.0025, unit: 'cm' }
    default:
      return { label: key, min: 0.005, max: 3, step: 0.005, unit: 'cm' }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One dimension row: label, slider, and a number box, Tinkercad-style. */
function DimRow({ piece, dimKey }: { piece: Piece; dimKey: string }) {
  const store = useStoreApi()
  const meta = dimMeta(piece, dimKey)
  const cm = meta.unit === 'cm'
  const toDisplay = (v: number) => (cm ? +(v * 100).toFixed(1) : Math.round(v))
  const fromDisplay = (v: number) => (cm ? v / 100 : Math.round(v))
  const value = piece.dimensions[dimKey]

  const apply = (raw: number, transient: boolean) => {
    if (!Number.isFinite(raw)) return
    const v = clamp(fromDisplay(raw), meta.min, meta.max)
    const s = store.getState()
    const current = s.doc.pieces.find((p) => p.id === piece.id)
    if (!current) return
    const patch = { dimensions: { ...current.dimensions, [dimKey]: v } }
    if (transient) s.updatePieceTransient(piece.id, patch)
    else s.updatePiece(piece.id, patch)
  }

  return (
    <div className="dim-row">
      <div className="dim-label">{meta.label}</div>
      <input
        type="range"
        aria-label={meta.label}
        min={toDisplay(meta.min)}
        max={toDisplay(meta.max)}
        step={cm ? meta.step * 100 : meta.step}
        value={toDisplay(value)}
        // A whole slider gesture is ONE undo entry (transient while sliding).
        onPointerDown={() => store.getState().beginTransient()}
        onChange={(e) => apply(parseFloat(e.target.value), true)}
        onPointerUp={() => store.getState().endTransient()}
        onBlur={() => store.getState().endTransient()}
      />
      <div className="dim-value">
        <input
          type="number"
          aria-label={`${meta.label} value`}
          key={`${dimKey}:${toDisplay(value)}`}
          step={cm ? meta.step * 100 : meta.step}
          defaultValue={toDisplay(value)}
          onBlur={(e) => apply(parseFloat(e.target.value), false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {cm && <span className="dim-unit">cm</span>}
      </div>
    </div>
  )
}

export function Properties() {
  const store = useStoreApi()
  const selectedId = useDocStore((s) => s.selectedId)
  const piece = useDocStore((s) => s.doc.pieces.find((p) => p.id === s.selectedId) ?? null)
  const materials = useDocStore((s) => s.doc.materials)

  if (!piece) {
    return (
      <div className="properties">
        <div className="label">PROPERTIES</div>
        <p className="muted">Nothing selected</p>
      </div>
    )
  }

  const update = (patch: Partial<Piece>) => store.getState().updatePiece(piece.id, patch)

  return (
    <div className="properties" key={selectedId ?? ''}>
      <div className="label">PROPERTIES</div>

      <label className="field">
        Name
        <input type="text" defaultValue={piece.name} onBlur={(e) => update({ name: e.target.value })} />
      </label>

      <label className="field">
        Material
        <select value={piece.material} onChange={(e) => update({ material: e.target.value })}>
          {materials.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={piece.anchored}
          onChange={(e) => update({ anchored: e.target.checked })}
        />
        Anchored
      </label>

      <div className="label" style={{ marginTop: 12 }}>
        DIMENSIONS
      </div>
      {Object.keys(piece.dimensions).map((key) => (
        <DimRow key={`${piece.id}:${key}`} piece={piece} dimKey={key} />
      ))}
    </div>
  )
}
