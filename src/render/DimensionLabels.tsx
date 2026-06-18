import { useState } from 'react'
import { Html } from '@react-three/drei'
import { MIN_DIM } from './transform'
import { useStoreApi } from '../ui/storeContext'
import type { Piece } from '../document/types'

export interface DimEntry {
  key: string
  value: number
}

/** The editable dimensions of a piece (box: x/y/z; cylinder: radius/height; sphere: radius). */
export function dimensionEntries(piece: Piece): DimEntry[] {
  return Object.entries(piece.dimensions).map(([key, value]) => ({ key, value }))
}

/** Inline editable dimension labels floating just above the selected piece. */
export function DimensionLabels({ piece }: { piece: Piece }) {
  const store = useStoreApi()
  const [editing, setEditing] = useState<string | null>(null)
  const entries = dimensionEntries(piece)
  const [px, py, pz] = piece.state.transform.position

  const commit = (key: string, raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) {
      store.getState().updatePiece(piece.id, {
        dimensions: { ...piece.dimensions, [key]: Math.max(MIN_DIM, v) },
      })
    }
    setEditing(null)
  }

  return (
    <Html position={[px, py + 0.4, pz]} center distanceFactor={6} style={{ pointerEvents: 'auto' }}>
      <div className="dim-labels">
        {entries.map((e) => (
          <span key={e.key} className="dim-label" onClick={() => setEditing(e.key)}>
            {editing === e.key ? (
              <input
                type="number"
                step="0.01"
                autoFocus
                defaultValue={e.value}
                onBlur={(ev) => commit(e.key, ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') commit(e.key, (ev.target as HTMLInputElement).value)
                }}
              />
            ) : (
              <>
                {e.key} {e.value.toFixed(2)}
              </>
            )}
          </span>
        ))}
      </div>
    </Html>
  )
}
