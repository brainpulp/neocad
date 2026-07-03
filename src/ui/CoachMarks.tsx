import { useState } from 'react'
import { useDocStore } from './storeContext'

const STORAGE_DISMISSED = 'neocad.tips.dismissed'
const STORAGE_OFF = 'neocad.tips.off'

interface Tip {
  id: string
  icon: string
  title: string
  body: string
}

const TIPS: Tip[] = [
  {
    id: 'drag',
    icon: '🖐',
    title: 'Pull pieces around',
    body:
      'Drag a piece to PULL it from the point you grabbed — it swings and sags under its own weight. ' +
      'Hold Ctrl (⌘) to carry it rigidly instead. Shift lifts it vertically; hold Alt while dragging to spin it.',
  },
  {
    id: 'joint',
    icon: '⚙',
    title: 'Making a joint',
    body:
      'Click point A on one piece, pick the joint type in the toolbar, then click point B on another piece. ' +
      'Points snap to bores, edges, ends and face centers — the loose piece jumps into alignment.',
  },
  {
    id: 'rope',
    icon: '🪢',
    title: 'Stringing a rope',
    body:
      'Click the first end — clicking on a piece TIES the rope to it — then click the second end. ' +
      'Thickness, slack and stiffness are in the inspector.',
  },
  {
    id: 'blower',
    icon: '🌬',
    title: 'Using the blower',
    body:
      'Press ▶ Run, then hold the mouse button to blow a jet of air where you point. ' +
      'The power slider is under FORCES on the right.',
  },
  {
    id: 'paused-edit',
    icon: '✏️',
    title: 'Editing while paused',
    body:
      'Drag the white corner handles to resize. HOLD ALT to show the rotate ring — drag it to turn in 15° steps ' +
      '(Shift = free), press X / Y / Z to change the axis. Alt-click drags away a copy. ' +
      'Ctrl (⌘)-drag moves a whole fastened assembly together.',
  },
  {
    id: 'multi-select',
    icon: '⬚',
    title: 'Selecting several pieces',
    body:
      'Shift-click adds pieces to the selection; Shift-drag on empty ground sweeps a selection box. ' +
      'Drag any selected piece to move them all; Delete removes them all.',
  },
]

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_DISMISSED) ?? '[]')
  } catch {
    return []
  }
}

/**
 * First-use coach tips: one very visible card the first time each interaction
 * becomes relevant, with a "don't show tips again" opt-out. Dismissals persist
 * in localStorage so tips never nag twice.
 */
export function CoachMarks() {
  const pieceCount = useDocStore((s) => s.doc.pieces.length)
  const running = useDocStore((s) => s.running)
  const tool = useDocStore((s) => s.tool)
  const selectedId = useDocStore((s) => s.selectedId)
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)
  const [off, setOff] = useState(() => localStorage.getItem(STORAGE_OFF) === '1')

  if (off) return null

  const relevant = (tip: Tip): boolean => {
    switch (tip.id) {
      case 'drag':
        return pieceCount > 0 && running
      case 'joint':
        return tool === 'joint'
      case 'rope':
        return tool === 'rope'
      case 'blower':
        return tool === 'blower'
      case 'paused-edit':
        return !running && selectedId != null
      case 'multi-select':
        // After the paused-editing tip has been read, not alongside it.
        return !running && pieceCount > 1 && dismissed.includes('paused-edit')
      default:
        return false
    }
  }

  const tip = TIPS.find((t) => !dismissed.includes(t.id) && relevant(t))
  if (!tip) return null

  const dismiss = () => {
    const next = [...dismissed, tip.id]
    setDismissed(next)
    localStorage.setItem(STORAGE_DISMISSED, JSON.stringify(next))
  }

  return (
    <div className="coach-card" role="status">
      <div className="coach-icon">{tip.icon}</div>
      <div className="coach-text">
        <strong>{tip.title}</strong>
        <p>{tip.body}</p>
        <div className="coach-actions">
          <button onClick={dismiss}>Got it</button>
          <label>
            <input
              type="checkbox"
              onChange={(e) => {
                if (e.target.checked) {
                  localStorage.setItem(STORAGE_OFF, '1')
                  setOff(true)
                }
              }}
            />
            Don't show tips again
          </label>
        </div>
      </div>
    </div>
  )
}
