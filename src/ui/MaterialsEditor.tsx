import { useState } from 'react'
import type { Material } from '../document/types'
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
        <MaterialRow key={m.name} material={m} />
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

/** One material: a compact summary row that expands to physics/appearance sliders. */
function MaterialRow({ material: m }: { material: Material }) {
  const store = useStoreApi()
  const set = (patch: Partial<Material>) => store.getState().updateMaterial(m.name, patch)

  return (
    <details className="material-item">
      <summary className="material-row">
        <input
          type="color"
          value={m.color}
          aria-label={`${m.name} color`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => set({ color: e.target.value })}
        />
        <span className="material-name">{m.name}</span>
        <input
          type="number"
          className="density"
          step="10"
          aria-label={`${m.name} density`}
          defaultValue={m.density}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v)) set({ density: v })
          }}
        />
      </summary>

      <div className="material-props">
        <MatSlider
          label="Grip (friction)"
          min={0}
          max={1.5}
          step={0.05}
          value={m.friction}
          ariaLabel={`${m.name} friction`}
          onChange={(v) => set({ friction: v })}
        />
        <MatSlider
          label="Bounce"
          min={0}
          max={1}
          step={0.05}
          value={m.restitution}
          ariaLabel={`${m.name} bounce`}
          onChange={(v) => set({ restitution: v })}
        />
        <label className="field">
          Magnetism
          <select
            aria-label={`${m.name} magnetism`}
            value={m.magnetic ?? ''}
            onChange={(e) => set({ magnetic: (e.target.value || undefined) as Material['magnetic'] })}
          >
            <option value="">None</option>
            <option value="magnet">Magnet (emits a field)</option>
            <option value="ferrous">Ferrous (pulled by magnets)</option>
          </select>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            aria-label={`${m.name} see-through`}
            checked={!!m.optics}
            onChange={(e) =>
              set({ optics: e.target.checked ? { transmission: 0.85, ior: 1.5, roughness: 0.1 } : undefined })
            }
          />
          See-through
        </label>
        {m.optics && (
          <MatSlider
            label="Clarity"
            min={0}
            max={1}
            step={0.05}
            value={m.optics.transmission}
            ariaLabel={`${m.name} clarity`}
            onChange={(v) => set({ optics: { ...m.optics!, transmission: v } })}
          />
        )}
      </div>
    </details>
  )
}

function MatSlider({
  label,
  min,
  max,
  step,
  value,
  ariaLabel,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  ariaLabel: string
  onChange: (v: number) => void
}) {
  return (
    <div className="dim-row">
      <div className="dim-label">
        {label} <span className="dim-unit">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}
