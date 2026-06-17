import { useDocStore } from './storeContext'

export function StatusBar() {
  const count = useDocStore((s) => s.doc.pieces.length)
  const running = useDocStore((s) => s.running)
  return (
    <div className="statusbar">
      <span>parts: {count}</span>
      <span>{running ? 'running' : 'paused'}</span>
    </div>
  )
}
