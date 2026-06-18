import { FASTENERS } from '../document/catalog'
import { useDocStore, useStoreApi } from './storeContext'

export function SceneTree() {
  const store = useStoreApi()
  const pieces = useDocStore((s) => s.doc.pieces)
  const fasteners = useDocStore((s) => s.doc.fasteners)
  const selectedId = useDocStore((s) => s.selectedId)

  const nameOf = (id: string) => pieces.find((p) => p.id === id)?.name ?? '?'

  return (
    <div className="scenetree">
      <div className="label">SCENE</div>
      {pieces.length === 0 && <p className="muted">empty</p>}
      {pieces.map((p) => (
        <div
          key={p.id}
          className={`tree-row${p.id === selectedId ? ' active' : ''}`}
          onClick={() => store.getState().select(p.id)}
        >
          <span className="tree-name">{p.name}</span>
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
      {fasteners.map((f) => (
        <div key={f.id} className="tree-row fastener">
          <span className="tree-name">
            {FASTENERS[f.type].label}: {nameOf(f.partA)} ↔ {nameOf(f.partB)}
          </span>
          <button
            aria-label={`delete fastener ${f.id}`}
            onClick={() => store.getState().removeFastener(f.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
