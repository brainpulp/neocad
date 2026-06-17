import { useDocStore } from './storeContext'

// M1 stub: shows the active tool / piece count. Editing comes in M2.
export function Properties() {
  const activeTool = useDocStore((s) => s.activeTool)
  const count = useDocStore((s) => s.doc.pieces.length)
  return (
    <div className="properties">
      <div className="label">PROPERTIES</div>
      <p>{activeTool ? `Placing: ${activeTool}` : 'Nothing selected'}</p>
      <p className="muted">{count} piece(s) in scene</p>
    </div>
  )
}
