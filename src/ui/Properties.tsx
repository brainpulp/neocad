import { FASTENERS, STOCK } from '../document/catalog'
import { flipJointAxis, swapJointEnds } from '../document/joints'
import { isJointType, type Piece } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

interface DimMeta {
  label: string
  /** Bounds/step in document units (meters, or raw for counts). */
  min: number
  max: number
  step: number
  /** 'cm' shows/edits centimeters; 'int' is a raw count. */
  unit: 'cm' | 'int'
}

/** Builder-friendly names + sensible ranges for each dimension of each stock. */
function dimMeta(piece: Piece, key: string): DimMeta {
  const mech = STOCK[piece.stockType].visual != null
  switch (key) {
    case 'x':
      return { label: 'Length', min: 0.01, max: 3, step: 0.005, unit: 'cm' }
    case 'y':
      return { label: 'Height', min: 0.005, max: 3, step: 0.005, unit: 'cm' }
    case 'z':
      return { label: 'Width', min: 0.01, max: 3, step: 0.005, unit: 'cm' }
    case 'radius':
      return { label: 'Radius', min: 0.005, max: 0.5, step: 0.0025, unit: 'cm' }
    case 'height':
      return mech
        ? { label: 'Thickness', min: 0.005, max: 0.12, step: 0.0025, unit: 'cm' }
        : { label: 'Length', min: 0.02, max: 3, step: 0.005, unit: 'cm' }
    case 'teeth':
      return { label: 'Teeth', min: 4, max: 48, step: 1, unit: 'int' }
    case 'lobe':
      return { label: 'Lobe offset', min: 0.005, max: 0.06, step: 0.0025, unit: 'cm' }
    default:
      return { label: key, min: 0.005, max: 3, step: 0.005, unit: 'cm' }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One dimension row: label, slider, and a number box, Tinkercad-style. */
function DimRow({ piece, dimKey }: { piece: Piece; dimKey: string }) {
  const store = useStoreApi()
  const meta = dimMeta(piece, dimKey)
  const cm = meta.unit === 'cm'
  const toDisplay = (v: number) => (cm ? +(v * 100).toFixed(1) : Math.round(v))
  const fromDisplay = (v: number) => (cm ? v / 100 : Math.round(v))
  const value = piece.dimensions[dimKey]

  const apply = (raw: number, transient: boolean) => {
    if (!Number.isFinite(raw)) return
    const v = clamp(fromDisplay(raw), meta.min, meta.max)
    const s = store.getState()
    const current = s.doc.pieces.find((p) => p.id === piece.id)
    if (!current) return
    const patch = { dimensions: { ...current.dimensions, [dimKey]: v } }
    if (transient) s.updatePieceTransient(piece.id, patch)
    else s.updatePiece(piece.id, patch)
  }

  return (
    <div className="dim-row">
      <div className="dim-label">{meta.label}</div>
      <input
        type="range"
        aria-label={meta.label}
        min={toDisplay(meta.min)}
        max={toDisplay(meta.max)}
        step={cm ? meta.step * 100 : meta.step}
        value={toDisplay(value)}
        // A whole slider gesture is ONE undo entry (transient while sliding).
        onPointerDown={() => store.getState().beginTransient()}
        onChange={(e) => apply(parseFloat(e.target.value), true)}
        onPointerUp={() => store.getState().endTransient()}
        onBlur={() => store.getState().endTransient()}
      />
      <div className="dim-value">
        <input
          type="number"
          aria-label={`${meta.label} value`}
          key={`${dimKey}:${toDisplay(value)}`}
          step={cm ? meta.step * 100 : meta.step}
          defaultValue={toDisplay(value)}
          onBlur={(e) => apply(parseFloat(e.target.value), false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {cm && <span className="dim-unit">cm</span>}
      </div>
    </div>
  )
}

export function Properties() {
  const store = useStoreApi()
  const selectedId = useDocStore((s) => s.selectedId)
  const piece = useDocStore((s) => s.doc.pieces.find((p) => p.id === s.selectedId) ?? null)
  const selectedFastener = useDocStore(
    (s) => s.doc.fasteners.find((f) => f.id === s.selectedFastenerId) ?? null,
  )
  const materials = useDocStore((s) => s.doc.materials)

  if (!piece && selectedFastener) return <JointProperties fastenerId={selectedFastener.id} />

  if (!piece) {
    return (
      <div className="properties">
        <div className="label">PROPERTIES</div>
        <p className="muted">Nothing selected</p>
        <WorkbenchSettings />
      </div>
    )
  }

  const update = (patch: Partial<Piece>) => store.getState().updatePiece(piece.id, patch)

  return (
    <div className="properties" key={selectedId ?? ''}>
      <div className="label">PROPERTIES</div>

      <label className="field">
        Name
        <input type="text" defaultValue={piece.name} onBlur={(e) => update({ name: e.target.value })} />
      </label>

      <label className="field">
        Material
        <select value={piece.material} onChange={(e) => update({ material: e.target.value })}>
          {materials.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <div className="btn-row">
        <button
          title="Return this piece to its rest placement"
          onClick={() => store.getState().resetPieces([piece.id])}
        >
          ↩ Put back
        </button>
        <button
          title="Make the current physical pose the new rest placement"
          onClick={() => store.getState().adoptPose([piece.id])}
        >
          ✓ Adopt pose
        </button>
      </div>

      <label className="field checkbox" title="A fixed piece is stationary — physics can't move it (F)">
        <input
          type="checkbox"
          checked={piece.anchored}
          onChange={(e) => update({ anchored: e.target.checked })}
        />
        📌 Fixed in place
      </label>

      <div className="label" style={{ marginTop: 12 }}>
        DIMENSIONS
      </div>
      {Object.keys(piece.dimensions).map((key) => (
        <DimRow key={`${piece.id}:${key}`} piece={piece} dimKey={key} />
      ))}
    </div>
  )
}

/** Inspector for the selected joint: precise limits, flip and swap. */
function JointProperties({ fastenerId }: { fastenerId: string }) {
  const store = useStoreApi()
  const f = useDocStore((s) => s.doc.fasteners.find((x) => x.id === fastenerId) ?? null)
  const pieces = useDocStore((s) => s.doc.pieces)
  if (!f) return null
  const a = pieces.find((p) => p.id === f.partA)
  const b = pieces.find((p) => p.id === f.partB)
  const joint = isJointType(f.type)
  const hasLimits = f.slideMin != null && f.slideMax != null
  const setLimit = (key: 'slideMin' | 'slideMax', cmValue: number) => {
    if (!Number.isFinite(cmValue)) return
    store.getState().updateFastener(f.id, { [key]: cmValue / 100 })
  }

  return (
    <div className="properties">
      <div className="label">JOINT</div>
      <p style={{ fontSize: 13, margin: '4px 0' }}>
        <strong>{FASTENERS[f.type].label}</strong>
        <br />
        <span className="muted">
          {a?.name ?? '?'} ↔ {b?.name ?? '?'}
        </span>
      </p>
      {joint && (
        <div className="btn-row">
          <button
            title="Reverse the axis direction"
            onClick={() => store.getState().updateFastener(f.id, flipJointAxis(f))}
          >
            ⇅ Flip axis
          </button>
          <button
            title="Exchange which piece is the reference (mate flip)"
            onClick={() => {
              if (a && b) store.getState().updateFastener(f.id, swapJointEnds(f, a, b))
            }}
          >
            ⇄ Swap ends
          </button>
        </div>
      )}
      {hasLimits && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            SLIDE LIMITS
          </div>
          {(['slideMin', 'slideMax'] as const).map((key) => (
            <div className="dim-row" key={`${f.id}:${key}:${f[key]}`}>
              <div className="dim-label">{key === 'slideMin' ? 'From' : 'To'}</div>
              <div className="dim-value">
                <input
                  type="number"
                  aria-label={key}
                  step={0.5}
                  defaultValue={+((f[key] ?? 0) * 100).toFixed(1)}
                  onBlur={(e) => setLimit(key, parseFloat(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <span className="dim-unit">cm</span>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="btn-row">
        <button
          onClick={() => {
            store.getState().removeFastener(f.id)
            store.getState().selectFastener(null)
          }}
        >
          🗑 Delete joint
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11 }}>
        Tip: while paused, drag the blue handles in the 3D view for coarse limits;
        drag a jointed piece to align its motion.
      </p>
    </div>
  )
}

/** Sandbox size, shown when nothing is selected. */
function WorkbenchSettings() {
  const store = useStoreApi()
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  if (!sandbox) return null
  return (
    <>
      <div className="label" style={{ marginTop: 12 }}>
        WORKBENCH
      </div>
      <div className="dim-row">
        <div className="dim-label">Size</div>
        <input
          type="range"
          aria-label="Workbench size"
          min={1}
          max={12}
          step={0.5}
          value={sandbox.size}
          onPointerDown={() => store.getState().beginTransient()}
          onChange={(e) => store.getState().setSandboxSizeTransient(parseFloat(e.target.value))}
          onPointerUp={() => store.getState().endTransient()}
        />
        <div className="dim-value">
          <span className="dim-unit">{sandbox.size.toFixed(1)} m</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11 }}>
        Physics keeps pieces on the bench; paused moves can take them off.
      </p>
    </>
  )
}
