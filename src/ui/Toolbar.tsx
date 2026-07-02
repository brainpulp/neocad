import { JOINT_TYPES, type JointType } from '../document/types'
import { FASTENERS } from '../document/catalog'
import { playBeep } from '../audio/impacts'
import { useDocStore, useStoreApi } from './storeContext'

interface ToolbarProps {
  onSave?: () => void
  onOpen?: () => void
  onExportGLTF?: () => void
  onExportSTL?: () => void
}

export function Toolbar({ onSave, onOpen, onExportGLTF, onExportSTL }: ToolbarProps) {
  const store = useStoreApi()
  const running = useDocStore((s) => s.running)
  const tool = useDocStore((s) => s.tool)
  const jointType = useDocStore((s) => s.jointType)
  const jointA = useDocStore((s) => s.jointA)
  const ropeStarted = useDocStore((s) => s.ropeStart != null)
  const soundOn = useDocStore((s) => s.soundOn)
  const canUndo = useDocStore((s) => s.past.length > 0)
  const canRedo = useDocStore((s) => s.future.length > 0)

  return (
    <div className="toolbar">
      <strong className="brand">NeoCad</strong>
      <button onClick={() => store.getState().setRunning(!running)}>
        {running ? '⏸ Pause' : '▶ Run'}
      </button>
      <button onClick={() => store.getState().reset()}>↺ Reset</button>
      <button
        title="Put back only the pieces knocked far from their rest placement"
        onClick={() => store.getState().tidy()}
      >
        🧹 Tidy
      </button>
      <span className="sep" />
      <button
        className={tool === 'transform' ? 'active' : ''}
        title={running ? 'Drag pieces across the canvas (Shift = lift)' : 'Move, rotate (rings) and resize (handles)'}
        onClick={() => store.getState().setTool('transform')}
      >
        ✥ Move
      </button>
      <button
        className={tool === 'joint' ? 'active' : ''}
        title="Connect two pieces with a moving joint: pick point A, then point B"
        onClick={() => store.getState().setTool('joint')}
      >
        ⚙ Joint
      </button>
      <button
        className={tool === 'rope' ? 'active' : ''}
        title="String a rope: click the first end (a piece ties it there), then the second"
        onClick={() => store.getState().setTool('rope')}
      >
        🪢 Rope
      </button>
      <button
        className={tool === 'blower' ? 'active' : ''}
        title="Blower: hold the mouse button while the sim runs to blow a jet of air at the cursor"
        onClick={() => store.getState().setTool('blower')}
      >
        🌬 Blow
      </button>
      {tool === 'blower' && (
        <span className="hint">
          {running ? 'hold the mouse button to blow where you point' : 'press ▶ Run, then hold to blow'}
        </span>
      )}
      {tool === 'rope' && (
        <span className="hint">
          {ropeStarted ? 'now click the other end' : 'click the first end (pieces tie the rope to them)'}
        </span>
      )}
      {tool === 'joint' && (
        <>
          <span className="segmented">
            {JOINT_TYPES.map((t: JointType) => (
              <button
                key={t}
                className={jointType === t ? 'active' : ''}
                title={FASTENERS[t].hint}
                onClick={() => store.getState().setJointType(t)}
              >
                {FASTENERS[t].label}
              </button>
            ))}
          </span>
          <span className="hint">{jointA ? 'now click point B on another piece' : 'click point A on a piece'}</span>
        </>
      )}
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => store.getState().undo()}>↶ Undo</button>
      <button disabled={!canRedo} onClick={() => store.getState().redo()}>↷ Redo</button>
      <span className="sep" />
      <button title="Zoom to fit everything" onClick={() => window.dispatchEvent(new Event('neocad:fit'))}>
        ⛶ Fit
      </button>
      <button
        title={soundOn ? 'Impact sounds on (click to mute)' : 'Impact sounds off'}
        onClick={() => {
          const next = !soundOn
          store.getState().setSoundOn(next)
          if (next) playBeep() // audible confirmation that output works
        }}
      >
        {soundOn ? '🔊' : '🔇'}
      </button>
      <span className="sep" />
      <button onClick={onSave}>💾 Save</button>
      <button onClick={onOpen}>📂 Open</button>
      <span className="sep" />
      <button onClick={onExportGLTF}>⬇ glTF</button>
      <button onClick={onExportSTL}>⬇ STL</button>
    </div>
  )
}
