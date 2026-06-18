import { useDocStore, useStoreApi } from './storeContext'
import type { Piece } from '../document/types'

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
  const setDimension = (key: string, value: number) => {
    if (Number.isFinite(value)) update({ dimensions: { ...piece.dimensions, [key]: value } })
  }

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
        <label className="field" key={key}>
          {key}
          <input
            type="number"
            step="0.01"
            aria-label={key}
            defaultValue={piece.dimensions[key]}
            onBlur={(e) => setDimension(key, parseFloat(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </label>
      ))}
    </div>
  )
}
