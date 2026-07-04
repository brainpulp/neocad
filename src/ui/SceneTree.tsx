import { FASTENERS } from '../document/catalog'
import { useDocStore, useStoreApi } from './storeContext'

export function SceneTree() {
  const store = useStoreApi()
  const pieces = useDocStore((s) => s.doc.pieces)
  const fasteners = useDocStore((s) => s.doc.fasteners)
  const selectedId = useDocStore((s) => s.selectedId)
  const selectedFastenerId = useDocStore((s) => s.selectedFastenerId)
  const ropes = useDocStore((s) => s.doc.ropes ?? [])
  const selectedRopeId = useDocStore((s) => s.selectedRopeId)

  const nameOf = (id: string) => pieces.find((p) => p.id === id)?.name ?? '?'
  const count = pieces.length + ropes.length + fasteners.length

  return (
    // Collapsible so the object list doesn't visually run into the inspector
    // below it (they read as one panel otherwise).
    <details open className="scenetree palette-section">
      <summary className="label">SCENE · {count}</summary>
      {pieces.length === 0 && <p className="muted">empty</p>}
      {pieces.map((p) => (
        <div
          key={p.id}
          className={`tree-row${p.id === selectedId ? ' active' : ''}`}
          onClick={() => store.getState().select(p.id)}
        >
          <span className="tree-name">{p.name}</span>
          <button
            aria-label={`${p.anchored ? 'unfix' : 'fix'} ${p.name}`}
            title={p.anchored ? 'Fixed in place — click to release' : 'Fix in place (F)'}
            className={p.anchored ? 'pin pinned' : 'pin'}
            onClick={(e) => {
              e.stopPropagation()
              store.getState().updatePiece(p.id, { anchored: !p.anchored })
            }}
          >
            📌
          </button>
          <button
            aria-label={`delete ${p.name}`}
            onClick={(e) => {
              e.stopPropagation()
              store.getState().removePiece(p.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {ropes.map((r) => (
        <div
          key={r.id}
          className={`tree-row${r.id === selectedRopeId ? ' active' : ''}`}
          onClick={() => store.getState().selectRope(r.id)}
        >
          <span className="tree-name">🪢 {r.name}</span>
          <button
            aria-label={`delete rope ${r.id}`}
            onClick={(e) => {
              e.stopPropagation()
              store.getState().removeRope(r.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {fasteners.map((f) => (
        <div
          key={f.id}
          className={`tree-row fastener${f.id === selectedFastenerId ? ' active' : ''}`}
          onClick={() => store.getState().selectFastener(f.id)}
          style={{ cursor: 'pointer' }}
        >
          <span className="tree-name">
            {FASTENERS[f.type].label}: {nameOf(f.partA)} ↔ {nameOf(f.partB)}
          </span>
          <button
            aria-label={`delete fastener ${f.id}`}
            onClick={(e) => {
              e.stopPropagation()
              store.getState().removeFastener(f.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </details>
  )
}
