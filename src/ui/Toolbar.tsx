import { useDocStore, useStoreApi } from './storeContext'

export function Toolbar({ onSave, onOpen }: { onSave?: () => void; onOpen?: () => void }) {
  const store = useStoreApi()
  const running = useDocStore((s) => s.running)
  const canUndo = useDocStore((s) => s.past.length > 0)
  const canRedo = useDocStore((s) => s.future.length > 0)

  return (
    <div className="toolbar">
      <strong className="brand">NeoCad</strong>
      <button onClick={() => store.getState().setRunning(!running)}>
        {running ? '⏸ Pause' : '▶ Run'}
      </button>
      <button onClick={() => store.getState().reset()}>↺ Reset</button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => store.getState().undo()}>↶ Undo</button>
      <button disabled={!canRedo} onClick={() => store.getState().redo()}>↷ Redo</button>
      <span className="sep" />
      <button onClick={onSave}>💾 Save</button>
      <button onClick={onOpen}>📂 Open</button>
    </div>
  )
}
