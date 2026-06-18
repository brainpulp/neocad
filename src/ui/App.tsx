import { useEffect, useMemo } from 'react'
import { createDocStore } from '../document/store'
import { StoreContext } from './storeContext'
import { Toolbar } from './Toolbar'
import { Palette } from './Palette'
import { Properties } from './Properties'
import { MaterialsEditor } from './MaterialsEditor'
import { StatusBar } from './StatusBar'
import { Scene } from '../render/Scene'
import { loadDoc, saveDoc } from '../persistence/autosave'
import { downloadDocument, pickDocument } from '../persistence/file'
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

  const onSave = () => downloadDocument(store.getState().doc)
  const onOpen = async () => {
    const d = await pickDocument()
    if (d) store.getState().loadDoc(d)
  }

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <Toolbar onSave={onSave} onOpen={onOpen} />
        <div className="body">
          <Palette />
          <div className="viewport">
            <Scene />
          </div>
          <div className="rightpanel">
            <Properties />
            <MaterialsEditor />
          </div>
        </div>
        <StatusBar />
      </div>
    </StoreContext.Provider>
  )
}
