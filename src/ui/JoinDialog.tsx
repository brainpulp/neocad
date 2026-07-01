import { FASTENERS, RIGID_FASTENER_TYPES } from '../document/catalog'
import { JOINT_TYPES } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

/**
 * Shown when a held piece is dropped onto another piece: the user picks how the
 * two attach (rigid fastener, moving joint, or nothing). Physics is paused while
 * this is open so the dropped piece holds still (store.pendingJoin).
 */
export function JoinDialog() {
  const store = useStoreApi()
  const pendingJoin = useDocStore((s) => s.pendingJoin)
  const doc = useDocStore((s) => s.doc)

  if (!pendingJoin) return null

  const nameOf = (id: string) => doc.pieces.find((p) => p.id === id)?.name ?? 'piece'
  const resolve = (type: Parameters<ReturnType<typeof store.getState>['resolveJoin']>[0]) =>
    store.getState().resolveJoin(type)

  return (
    <div className="join-dialog" role="dialog" aria-label="Attach pieces">
      <div className="join-dialog-title">
        Attach {nameOf(pendingJoin.pieceId)} to {nameOf(pendingJoin.targetId)}?
      </div>
      <div className="join-dialog-group">
        <span className="join-dialog-label">Rigid</span>
        {RIGID_FASTENER_TYPES.map((t) => (
          <button key={t} title={FASTENERS[t].hint} onClick={() => resolve(t)}>
            {FASTENERS[t].label}
          </button>
        ))}
      </div>
      <div className="join-dialog-group">
        <span className="join-dialog-label">Moving</span>
        {JOINT_TYPES.map((t) => (
          <button key={t} title={FASTENERS[t].hint} onClick={() => resolve(t)}>
            {FASTENERS[t].label}
          </button>
        ))}
      </div>
      <div className="join-dialog-group">
        <button className="join-dialog-none" onClick={() => resolve(null)}>
          Don’t attach — just rest it there
        </button>
      </div>
    </div>
  )
}
