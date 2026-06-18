import { useDocStore } from '../ui/storeContext'

/** Centered hint over the viewport while the scene is empty. Plain DOM (not in Canvas). */
export function EmptyState() {
  const count = useDocStore((s) => s.doc.pieces.length)
  if (count > 0) return null
  return <div className="empty-state">Pick a stock from the left to start building.</div>
}
