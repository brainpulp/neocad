import { useDocStore } from './storeContext'

export function StatusBar() {
  const count = useDocStore((s) => s.doc.pieces.length)
  const fasteners = useDocStore((s) => s.doc.fasteners.length)
  const running = useDocStore((s) => s.running)
  return (
    <div className="statusbar">
      <span>parts: {count}</span>
      <span>fasteners: {fasteners}</span>
      <span>{running ? 'running' : 'paused'}</span>
    </div>
  )
}
