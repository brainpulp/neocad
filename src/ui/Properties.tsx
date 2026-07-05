import { useState } from 'react'
import { FASTENERS, STOCK, formatMass, pieceMass } from '../document/catalog'
import { hollowable, type FaceId } from '../document/hollow'
import { flipJointAxis, swapJointEnds } from '../document/joints'
import { isJointType, type Piece } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

/** Name of the piece that ADJUST will move — same rule as joining: the part
 * that CAME to the joint (B) moves; a fixed part never does. */
function moverName(a: Piece, b: Piece): string {
  if (!b.anchored) return b.name
  if (!a.anchored) return a.name
  return '— both fixed'
}

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
  const selectedRope = useDocStore(
    (s) => (s.doc.ropes ?? []).find((r) => r.id === s.selectedRopeId) ?? null,
  )
  const materials = useDocStore((s) => s.doc.materials)

  if (!piece && selectedFastener) return <JointProperties fastenerId={selectedFastener.id} />
  if (!piece && selectedRope) return <RopeProperties ropeId={selectedRope.id} />

  // Floating inspector: only exists when something IS selected (Tinkercad-
  // style). Workbench/scene settings live in the sidebar, not here.
  if (!piece) return null

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

      <div className="dim-row" title="Material density × volume — what physics simulates">
        <div className="dim-label">Weight</div>
        <div className="dim-value">
          <span className="dim-unit" data-testid="piece-weight">
            ⚖ {formatMass(pieceMass(piece, materials))}
          </span>
        </div>
      </div>

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

      <HollowControls piece={piece} />
    </div>
  )
}

/** Face options for a box's open side; cylinders open a cap (cup) or neither (tube). */
const BOX_FACES: { id: FaceId; label: string }[] = [
  { id: '+y', label: 'Top' },
  { id: '-y', label: 'Bottom' },
  { id: '+x', label: 'Right' },
  { id: '-x', label: 'Left' },
  { id: '+z', label: 'Front' },
  { id: '-z', label: 'Back' },
]

/** Hollow (wall-thickness) controls for box/cylinder stock. */
function HollowControls({ piece }: { piece: Piece }) {
  const store = useStoreApi()
  if (!hollowable(piece)) return null
  const primitive = STOCK[piece.stockType].primitive
  const h = piece.hollow
  const update = (hollow: Piece['hollow']) => store.getState().updatePiece(piece.id, { hollow })
  const thicknessCm = Math.round((h?.thickness ?? 0.02) * 1000) / 10

  return (
    <>
      <div className="label" style={{ marginTop: 12 }}>
        HOLLOW
      </div>
      <label className="field checkbox" title="Hollow the piece out to a shell with walls">
        <input
          type="checkbox"
          checked={!!h}
          onChange={(e) => update(e.target.checked ? { thickness: 0.02 } : undefined)}
        />
        Hollow out
      </label>
      {h && (
        <>
          <div className="dim-row">
            <div className="dim-label">Wall thickness</div>
            <input
              type="range"
              aria-label="Wall thickness"
              min={0.2}
              max={20}
              step={0.1}
              value={thicknessCm}
              onChange={(e) => update({ ...h, thickness: parseFloat(e.target.value) / 100 })}
            />
            <div className="dim-value">
              <input
                type="number"
                value={thicknessCm}
                step={0.5}
                onChange={(e) => update({ ...h, thickness: parseFloat(e.target.value) / 100 })}
              />
              <span className="dim-unit">cm</span>
            </div>
          </div>
          <label className="field">
            {primitive === 'cylinder' ? 'Open end' : 'Open face'}
            <select
              value={h.openFace ?? ''}
              onChange={(e) =>
                update({ ...h, openFace: (e.target.value || undefined) as FaceId | undefined })
              }
            >
              {primitive === 'cylinder' ? (
                <>
                  <option value="">Tube (both ends open)</option>
                  <option value="+y">Cup — open top</option>
                  <option value="-y">Cup — open bottom</option>
                </>
              ) : (
                <>
                  <option value="">Closed (all walls)</option>
                  {BOX_FACES.map((f) => (
                    <option key={f.id} value={f.id}>
                      Open {f.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
        </>
      )}
    </>
  )
}

/**
 * Slide the part along the joint axis, numerically. The value is a SESSION
 * offset from wherever the part sat when the joint was selected (0 = as
 * landed); dragging the slider or typing cm applies the DELTA as a real move.
 */
function OffsetRow({ fastenerId }: { fastenerId: string }) {
  const store = useStoreApi()
  const [offset, setOffset] = useState(0) // cm
  const apply = (cm: number) => {
    if (!Number.isFinite(cm)) return
    const clamped = Math.max(-100, Math.min(100, cm))
    const delta = (clamped - offset) / 100
    if (delta !== 0) store.getState().adjustJoint(fastenerId, { slide: delta })
    setOffset(clamped)
  }
  return (
    <div className="dim-row" title="Shift the part along the joint axis (0 = where it landed)">
      <div className="dim-label">Offset along axis</div>
      <input
        type="range"
        aria-label="Offset along axis"
        min={-50}
        max={50}
        step={0.5}
        value={offset}
        onChange={(e) => apply(parseFloat(e.target.value))}
      />
      <div className="dim-value">
        <input
          type="number"
          value={Math.round(offset * 10) / 10}
          step={0.5}
          onChange={(e) => apply(parseFloat(e.target.value))}
        />
        <span className="dim-unit">cm</span>
      </div>
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
      {/* ADJUST: actually MOVES the loose piece about/along the joint axis, so
          you can fix a bad angle or slide it into place (Onshape-style). */}
      <div className="label" style={{ marginTop: 8 }}>
        ADJUST {a && b ? `(moves ${moverName(a, b)})` : ''}
      </div>
      <div className="btn-row">
        <button title="Turn −15° about the joint axis" onClick={() => store.getState().adjustJoint(f.id, { rotate: -Math.PI / 12 })}>
          ↺ −15°
        </button>
        <button title="Turn +15° about the joint axis" onClick={() => store.getState().adjustJoint(f.id, { rotate: Math.PI / 12 })}>
          ↻ +15°
        </button>
        <button title="Turn it 180° to the other side" onClick={() => store.getState().adjustJoint(f.id, { rotate: Math.PI })}>
          ⟲ Flip
        </button>
      </div>
      <div className="btn-row">
        <button title="Slide 2 cm along the axis" onClick={() => store.getState().adjustJoint(f.id, { slide: -0.02 })}>
          ← Slide
        </button>
        <button title="Slide 2 cm along the axis" onClick={() => store.getState().adjustJoint(f.id, { slide: 0.02 })}>
          Slide →
        </button>
      </div>
      <OffsetRow fastenerId={f.id} />
      {joint && (
        <div className="btn-row">
          <button
            title="Reverse the motion axis direction (swaps which way it drives)"
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
      {!joint && f.type !== 'spring' && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            BOND STRENGTH
          </div>
          <div className="dim-row" title="The join snaps past this load — a physics event, not an edit">
            <input
              type="range"
              aria-label="Bond strength"
              min={20}
              max={1000}
              step={10}
              value={Math.round((f.strength ?? FASTENERS[f.type].strength ?? 9000) / 9.81)}
              onChange={(e) =>
                store.getState().updateFastener(f.id, {
                  strength: parseFloat(e.target.value) * 9.81,
                })
              }
            />
            <span className="dim-unit">
              holds ~{Math.round((f.strength ?? FASTENERS[f.type].strength ?? 9000) / 9.81)} kg
            </span>
          </div>
        </>
      )}
      {f.type === 'pivot' && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            SWING LIMITS
          </div>
          {(['angleMin', 'angleMax'] as const).map((key) => (
            <div className="dim-row" key={`${f.id}:${key}:${f[key]}`}>
              <div className="dim-label">{key === 'angleMin' ? 'From' : 'To'}</div>
              <div className="dim-value">
                <input
                  type="number"
                  aria-label={key}
                  step={5}
                  placeholder="free"
                  defaultValue={f[key] != null ? Math.round((f[key]! * 180) / Math.PI) : ''}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    store.getState().updateFastener(f.id, {
                      [key]: Number.isFinite(v) ? (v * Math.PI) / 180 : undefined,
                    })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <span className="dim-unit">°</span>
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 11, margin: '2px 0' }}>
            Empty = swings freely. 0° is the pose when the joint was made.
          </p>
        </>
      )}
      {f.type === 'cylindrical' && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            MOTION
          </div>
          <label className="field checkbox" title="Allow rotation about the axis">
            <input
              type="checkbox"
              checked={f.canSpin ?? true}
              onChange={(e) => store.getState().updateFastener(f.id, { canSpin: e.target.checked })}
            />
            ↻ Can spin
          </label>
          <label className="field checkbox" title="Allow sliding along the axis">
            <input
              type="checkbox"
              checked={f.canSlide ?? true}
              onChange={(e) => store.getState().updateFastener(f.id, { canSlide: e.target.checked })}
            />
            ⇕ Can slide
          </label>
        </>
      )}
      {(f.type === 'pivot' || f.type === 'linear') && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            MOTOR
          </div>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={f.motor?.enabled ?? false}
              onChange={(e) =>
                store.getState().updateFastener(f.id, {
                  motor: {
                    enabled: e.target.checked,
                    velocity: f.motor?.velocity ?? (f.type === 'pivot' ? 3 : 0.3),
                    maxForce: f.motor?.maxForce ?? 50,
                  },
                })
              }
            />
            ⚡ Driven
          </label>
          {f.motor?.enabled && (
            <>
              <div className="dim-row">
                <div className="dim-label">
                  Speed {f.type === 'pivot' ? '(rad/s)' : '(m/s)'}
                </div>
                <input
                  type="range"
                  aria-label="Motor speed"
                  min={f.type === 'pivot' ? -12 : -1.5}
                  max={f.type === 'pivot' ? 12 : 1.5}
                  step={f.type === 'pivot' ? 0.5 : 0.05}
                  value={f.motor.velocity}
                  onChange={(e) =>
                    store.getState().updateFastener(f.id, {
                      motor: { ...f.motor!, velocity: parseFloat(e.target.value) },
                    })
                  }
                />
                <span className="dim-unit">{f.motor.velocity.toFixed(2)}</span>
              </div>
              <div className="dim-row">
                <div className="dim-label">Strength</div>
                <input
                  type="range"
                  aria-label="Motor strength"
                  min={1}
                  max={500}
                  step={1}
                  value={f.motor.maxForce}
                  onChange={(e) =>
                    store.getState().updateFastener(f.id, {
                      motor: { ...f.motor!, maxForce: parseFloat(e.target.value) },
                    })
                  }
                />
              </div>
            </>
          )}
        </>
      )}
      {f.type === 'spring' && f.spring && (
        <>
          <div className="label" style={{ marginTop: 10 }}>
            SPRING
          </div>
          <div className="dim-row">
            <div className="dim-label">Stiffness</div>
            <input
              type="range"
              aria-label="Spring stiffness"
              min={0.5}
              max={12}
              step={0.5}
              value={f.spring.frequency}
              onChange={(e) =>
                store.getState().updateFastener(f.id, {
                  spring: { ...f.spring!, frequency: parseFloat(e.target.value) },
                })
              }
            />
            <span className="dim-unit">{f.spring.frequency.toFixed(1)} Hz</span>
          </div>
          <div className="dim-row">
            <div className="dim-label">Damping</div>
            <input
              type="range"
              aria-label="Spring damping"
              min={0}
              max={1}
              step={0.05}
              value={f.spring.damping}
              onChange={(e) =>
                store.getState().updateFastener(f.id, {
                  spring: { ...f.spring!, damping: parseFloat(e.target.value) },
                })
              }
            />
          </div>
          <div className="dim-row">
            <div className="dim-label">Rest length</div>
            <div className="dim-value">
              <input
                type="number"
                aria-label="Spring rest length"
                step={1}
                key={`rest:${f.spring.restLength}`}
                defaultValue={+(f.spring.restLength * 100).toFixed(1)}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0)
                    store.getState().updateFastener(f.id, {
                      spring: { ...f.spring!, restLength: v / 100 },
                    })
                }}
              />
              <span className="dim-unit">cm</span>
            </div>
          </div>
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

/** Inspector for the selected rope. */
function RopeProperties({ ropeId }: { ropeId: string }) {
  const store = useStoreApi()
  const rope = useDocStore((s) => (s.doc.ropes ?? []).find((r) => r.id === ropeId) ?? null)
  if (!rope) return null
  const upd = (patch: Partial<typeof rope>) => store.getState().updateRope(rope.id, patch)
  const row = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
    suffix?: string,
  ) => (
    <div className="dim-row">
      <div className="dim-label">{label}</div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => apply(parseFloat(e.target.value))}
      />
      {suffix && <span className="dim-unit">{suffix}</span>}
    </div>
  )
  return (
    <div className="properties">
      <div className="label">ROPE</div>
      {row('Thickness', 0.5, 4, 0.25, rope.radius * 100, (v) => upd({ radius: v / 100 }), `${(rope.radius * 100).toFixed(2)} cm`)}
      {row('Slack', 1, 2, 0.05, rope.slack, (v) => upd({ slack: v }), `×${rope.slack.toFixed(2)}`)}
      {row(
        'Springiness',
        0,
        1,
        0.05,
        rope.elasticity ?? 0,
        (v) => upd({ elasticity: v }),
        (rope.elasticity ?? 0) < 0.03 ? 'rope' : `bungee ${Math.round((rope.elasticity ?? 0) * 100)}%`,
      )}
      {row('Segments', 8, 48, 1, rope.segments, (v) => upd({ segments: Math.round(v) }), `${rope.segments}`)}
      <label className="field checkbox" title="Close the rope into a loop (belt)">
        <input type="checkbox" checked={rope.looped} onChange={(e) => upd({ looped: e.target.checked })} />
        ➰ Looped (belt)
      </label>
      <p className="muted" style={{ fontSize: 11 }}>
        Ends: {rope.attachStart ? 'tied' : 'free'} / {rope.attachEnd ? 'tied' : 'free'}.
        Tie ends by clicking pieces while stringing.
      </p>
      <div className="btn-row">
        <button
          onClick={() => {
            store.getState().removeRope(rope.id)
            store.getState().selectRope(null)
          }}
        >
          🗑 Delete rope
        </button>
      </div>
    </div>
  )
}

/** Sandbox size — scene-level, lives in the sidebar with SCENE and FORCES. */
export function WorkbenchSettings() {
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
