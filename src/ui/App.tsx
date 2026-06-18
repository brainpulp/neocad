import { useEffect, useMemo } from 'react'
import { createDocStore } from '../document/store'
import { StoreContext } from './storeContext'
import { Toolbar } from './Toolbar'
import { Palette } from './Palette'
import { Properties } from './Properties'
import { MaterialsEditor } from './MaterialsEditor'
import { SceneTree } from './SceneTree'
import { StatusBar } from './StatusBar'
import { Scene } from '../render/Scene'
import { EmptyState } from '../render/EmptyState'
import { isEditableTarget, keyToAction } from './keyboard'
import { loadDoc, saveDoc } from '../persistence/autosave'
import { downloadDocument, pickDocument } from '../persistence/file'
import { exportGLTF, exportSTL } from '../export/exporters'
import './app.css'

export function App() {
  const store = useMemo(() => createDocStore(), [])

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

  // Global keyboard shortcuts (ignored while typing in form fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target as Element | null)) return
      const action = keyToAction(e)
      if (!action) return
      e.preventDefault()
      const s = store.getState()
      if (action === 'delete') {
        if (s.selectedId) s.removePiece(s.selectedId)
      } else if (action === 'cancel') {
        s.setActiveTool(null)
        s.setFastenTool(null)
        s.select(null)
      } else if (action === 'undo') {
        s.undo()
      } else if (action === 'redo') {
        s.redo()
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
          </div>
          <div className="rightpanel">
            <SceneTree />
            <Properties />
            <MaterialsEditor />
          </div>
        </div>
        <StatusBar />
      </div>
    </StoreContext.Provider>
  )
}
