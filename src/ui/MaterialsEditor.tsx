import { useState } from 'react'
import { useDocStore, useStoreApi } from './storeContext'

export function MaterialsEditor() {
  const store = useStoreApi()
  const materials = useDocStore((s) => s.doc.materials)
  const [newName, setNewName] = useState('')

  const addNew = () => {
    const name = newName.trim()
    if (!name || materials.some((m) => m.name === name)) return
    store.getState().addMaterial({ name, density: 1000, friction: 0.4, restitution: 0.2, color: '#888888' })
    setNewName('')
  }

  return (
    <div className="materials-editor">
      <div className="label" style={{ marginTop: 12 }}>
        MATERIALS
      </div>
      {materials.map((m) => (
        <div className="material-row" key={m.name}>
          <input
            type="color"
            value={m.color}
            aria-label={`${m.name} color`}
            onChange={(e) => store.getState().updateMaterial(m.name, { color: e.target.value })}
          />
          <span className="material-name">{m.name}</span>
          <input
            type="number"
            className="density"
            step="10"
            aria-label={`${m.name} density`}
            defaultValue={m.density}
            onBlur={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) store.getState().updateMaterial(m.name, { density: v })
            }}
          />
        </div>
      ))}
      <div className="material-row">
        <input
          type="text"
          placeholder="new material"
          aria-label="new material name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addNew()
          }}
        />
        <button onClick={addNew}>+ new</button>
      </div>
    </div>
  )
}
