import { useEffect, useMemo } from 'react'
import { createDocStore } from '../document/store'
import { StoreContext, useDocStore } from './storeContext'
import { Toolbar } from './Toolbar'
import { Palette } from './Palette'
import { Properties } from './Properties'
import { MaterialsEditor } from './MaterialsEditor'
import { EnvPanel } from './EnvPanel'
import { SceneTree } from './SceneTree'
import { JoinDialog } from './JoinDialog'
import { CoachMarks } from './CoachMarks'
import { StatusBar } from './StatusBar'
import { Scene } from '../render/Scene'
import { EmptyState } from '../render/EmptyState'
import { isEditableTarget, keyToAction } from './keyboard'
import { loadDoc, saveDoc } from '../persistence/autosave'
import { ensureAudio } from '../audio/impacts'
import { downloadDocument, pickDocument } from '../persistence/file'
import { exportGLTF, exportSTL } from '../export/exporters'
import './app.css'

export function App() {
  const store = useMemo(() => createDocStore(), [])

  // Dev-only hook so e2e scripts can read/drive the document store.
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__neocadStore = store
  }

  // Restore the last working document on launch.
  useEffect(() => {
    let cancelled = false
    loadDoc().then((d) => {
      if (d && !cancelled) store.getState().loadDoc(d)
    })
    return () => {
      cancelled = true
    }
  }, [store])

  // Debounced autosave whenever the document changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastDoc = store.getState().doc
    const unsub = store.subscribe((s) => {
      if (s.doc === lastDoc) return
      lastDoc = s.doc
      clearTimeout(timer)
      timer = setTimeout(() => void saveDoc(s.doc), 500)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [store])

  // Browsers gate audio behind a user gesture: (re-)arm the impact-sound engine
  // on every pointer press — a single attempt can lose the race with stricter
  // autoplay policies, and resume() is a no-op once running.
  useEffect(() => {
    const arm = () => void ensureAudio()
    // Keydown too: the spacebar slingshot may be the FIRST gesture that should
    // make noise, and it never goes through pointerdown.
    window.addEventListener('pointerdown', arm)
    window.addEventListener('keydown', arm)
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  // Global keyboard shortcuts (ignored while typing in form fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target as Element | null)) return
      const action = keyToAction(e)
      if (!action) return
      e.preventDefault()
      const s = store.getState()
      if (action === 'delete') {
        if (s.selectedIds.length > 1) s.removePieces(s.selectedIds)
        else if (s.selectedId) s.removePiece(s.selectedId)
      } else if (action === 'cancel') {
        if (s.pendingJoin) s.resolveJoin(null) // Esc on the attach dialog = don't attach
        s.setActiveTool(null)
        s.setFastenTool(null)
        s.cancelJoint()
        s.select(null)
        s.selectFastener(null)
      } else if (action === 'undo') {
        s.undo()
      } else if (action === 'redo') {
        s.redo()
      } else if (action === 'fix') {
        const piece = s.doc.pieces.find((p) => p.id === s.selectedId)
        if (piece) s.updatePiece(piece.id, { anchored: !piece.anchored })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const onSave = () => downloadDocument(store.getState().doc)
  const onOpen = async () => {
    const d = await pickDocument()
    if (d) store.getState().loadDoc(d)
  }

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <Toolbar
          onSave={onSave}
          onOpen={onOpen}
          onExportGLTF={() => exportGLTF(store.getState().doc)}
          onExportSTL={() => exportSTL(store.getState().doc)}
        />
        <div className="body">
          <Palette />
          <div className="viewport">
            <Scene />
            <EmptyState />
            <JoinDialog />
            <MarqueeOverlay />
            <CoachMarks />
          </div>
          <div className="rightpanel">
            <SceneTree />
            <Properties />
            <EnvPanel />
            <MaterialsEditor />
          </div>
        </div>
        <StatusBar />
      </div>
    </StoreContext.Provider>
  )
}

/** The marquee rectangle (Shift+drag on empty ground while paused). */
function MarqueeOverlay() {
  const m = useDocStore((s) => s.marquee)
  if (!m) return null
  const left = Math.min(m.x0, m.x1)
  const top = Math.min(m.y0, m.y1)
  return (
    <div
      className="marquee"
      style={{ left, top, width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0) }}
    />
  )
}
