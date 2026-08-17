import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, Grid, Html, Line, OrbitControls } from '@react-three/drei'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  ACESFilmicToneMapping,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  Vector3,
  type BufferGeometry,
} from 'three'
import { textureFor } from '../render/textures'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import { csgToGeometry } from '../render/csg'
import { downloadBlob } from '../persistence/file'
import { defaultStairSpec, newTurn, type StairSpec, type StringerKind, type TurnSpec } from './spec'
import { layoutStair } from './layout'
import { stairToCsg, stairKey } from './build'
import { stairBom, bomToCsv } from './bom'
import { flightSetouts, setoutToCsv, setoutSvg } from './setout'

/**
 * Standalone stair-generator playground (`?stairs`). Parameters drive the pure
 * layout + manifold mesher live; turns (landings/winders) split the walk into
 * flights, stringers spec the sidings, and a cut list orders the wood. The exact
 * solid re-meshes on change (falling back to the previous mesh while pending) and
 * exports to STL/glTF.
 */

const WOODS = ['pine', 'oak', 'walnut', 'plywood', 'bamboo', 'mdf', 'maple']

/**
 * A number box that shows EXACTLY what you type. While focused it holds a local
 * text buffer (so half-typed values like "5" on the way to "500" aren't clobbered
 * by re-formatting or clamped away); the model is updated live (clamped so the
 * preview stays valid) and the box reverts to the model's rounded value on blur.
 */
/** A tiny labelled mm number box (local buffer so typing shows exactly what you type). */
function MiniNum({ label, vmm, onCommit }: { label: string; vmm: number; onCommit: (mm: number) => void }) {
  const [buf, setBuf] = useState<string | null>(null)
  return (
    <label style={{ fontSize: 10, display: 'flex', flexDirection: 'column', flex: 1, gap: 1 }}>
      <span style={{ opacity: 0.55 }}>{label}</span>
      <input
        type="number"
        value={buf ?? String(Math.round(vmm))}
        onFocus={(e) => { setBuf(String(Math.round(vmm))); e.currentTarget.select() }}
        onChange={(e) => { setBuf(e.target.value); const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onCommit(v) }}
        onBlur={() => setBuf(null)}
        style={{ width: '100%', fontSize: 11, textAlign: 'right', background: '#2a2b2f', color: '#e8e8ea', border: '1px solid #444', borderRadius: 3, padding: '1px 3px' }}
      />
    </label>
  )
}

function NumField({ value, min, max, step, scale, onChange }: {
  value: number; min: number; max: number; step: number; scale: number; onChange: (v: number) => void
}) {
  const shown = String(Math.round(value * scale * 100) / 100)
  const [buf, setBuf] = useState<string | null>(null)
  return (
    <input
      type="number"
      value={buf ?? shown}
      min={min * scale}
      max={max * scale}
      step={step * scale}
      onFocus={(e) => { setBuf(shown); e.currentTarget.select() }}
      onChange={(e) => {
        setBuf(e.target.value)
        const v = parseFloat(e.target.value)
        if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v / scale)))
      }}
      onBlur={() => setBuf(null)}
      style={{ width: 62, fontSize: 12, textAlign: 'right', background: '#2a2b2f', color: '#e8e8ea', border: '1px solid #444', borderRadius: 4, padding: '2px 4px' }}
    />
  )
}

/**
 * A labelled control with BOTH a range slider and a typeable number box (shown in
 * display units, e.g. mm). Tab moves between the number boxes; focusing one
 * selects its text so you can Tab-then-type to punch an exact value.
 */
function Slider({ label, value, min, max, step, unit = 'mm', scale = 1000, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'block', margin: '9px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <NumField value={value} min={min} max={max} step={step} scale={scale} onChange={onChange} />
          <span style={{ opacity: 0.6, width: 20 }}>{unit}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: '100%' }} tabIndex={-1} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  )
}

/** Bakes three's procedural room to a PMREM probe → scene.environment, for real
 *  image-based lighting (no external HDR). Same trick as the main builder. */
function StudioEnv() {
  const { scene, gl } = useThree()
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture
    return () => {
      scene.environment = null
      env.texture.dispose()
      pmrem.dispose()
    }
  }, [scene, gl])
  return null
}

function StairMesh({ geometry, wood, onBounds }: { geometry: BufferGeometry; wood: string; onBounds: (c: Vector3, r: number) => void }) {
  const material = useMemo(() => {
    const map = textureFor(wood)
    if (map) {
      map.wrapS = map.wrapT = 1000 // RepeatWrapping
      map.repeat.set(3, 3)
    }
    return new MeshStandardMaterial({ color: '#caa06a', map: map ?? undefined, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.85 })
  }, [wood])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    const c = new Vector3(); box.getCenter(c)
    onBounds(c, box.getSize(new Vector3()).length() / 2)
  }, [geometry, onBounds])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

/** On-model dimension labels: at each tread nosing, the running HEIGHT from the
 *  floor (the riser mark) and the going — fixed screen size, toggle on/off. */
function StepDims({ parts }: { parts: ReturnType<typeof layoutStair>['parts'] }) {
  const treads = parts.filter((p) => p.kind === 'tread' && p.shape === 'box') as Array<{ center: [number, number, number]; size: [number, number, number]; rotYDeg: number }>
  const going = treads[0] ? Math.round((treads[0].size[2]) * 1000) : 0
  return (
    <>
      {treads.map((t, i) => {
        const [cx, cy, cz] = t.center
        const [w, tt, d] = t.size
        const th = (t.rotYDeg || 0) * (Math.PI / 180)
        const fx = Math.sin(th), fz = Math.cos(th), rx = Math.cos(th), rz = -Math.sin(th)
        // outer-front (nosing) corner of the tread top
        const px = cx - fx * (d / 2) + rx * (w / 2)
        const py = cy + tt / 2
        const pz = cz - fz * (d / 2) + rz * (w / 2)
        const h = Math.round((cy + tt / 2) * 1000)
        return (
          <Html key={i} position={[px, py, pz]} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(20,22,26,0.9)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'system-ui', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>
              {h}
            </div>
          </Html>
        )
      })}
      {treads[0] && (
        <Html position={[treads[0].center[0], treads[0].center[1] + 0.5, treads[0].center[2]]} center style={{ pointerEvents: 'none' }}>
          <div style={{ background: '#3b82c4', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>going {going} mm · heights from floor (mm)</div>
        </Html>
      )}
    </>
  )
}

// ---- context boxes (walls / floors / ceilings the stair sits in) -----------
type BoxKind = 'floor' | 'ceiling' | 'wall' | 'box'
interface CBox {
  id: number
  kind: BoxKind
  size: [number, number, number]
  pos: [number, number, number]
}
const BOX_COLOR: Record<BoxKind, string> = { floor: '#8aa0ab', ceiling: '#a7b6bd', wall: '#a1887f', box: '#7cb342' }
const mmv = (x: number) => Math.round(x * 1000)
const pill: React.CSSProperties = { background: 'rgba(20,22,26,0.9)', color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'system-ui', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }

/** User-placed boxes with ALWAYS-ON dimension labels, so you can recreate the
 *  surrounding floors/ceilings/walls and read the fit (incl. floor→ceiling). */
function ContextBoxes({ boxes }: { boxes: CBox[] }) {
  const floor = boxes.find((b) => b.kind === 'floor')
  const ceil = boxes.find((b) => b.kind === 'ceiling')
  let clear: React.ReactNode = null
  if (floor && ceil) {
    const ft = floor.pos[1] + floor.size[1] / 2
    const cb = ceil.pos[1] - ceil.size[1] / 2
    const cx = floor.pos[0], cz = floor.pos[2]
    clear = (
      <>
        <Line points={[[cx, ft, cz], [cx, cb, cz]]} color="#c0392b" lineWidth={2} />
        <Html center position={[cx, (ft + cb) / 2, cz]} style={{ pointerEvents: 'none' }}>
          <div style={{ ...pill, background: '#c0392b' }}>floor→ceiling {mmv(cb - ft)} mm</div>
        </Html>
      </>
    )
  }
  return (
    <>
      {boxes.map((b) => (
        <group key={b.id} position={b.pos}>
          <mesh>
            <boxGeometry args={b.size} />
            <meshStandardMaterial color={BOX_COLOR[b.kind]} transparent opacity={0.14} side={DoubleSide} depthWrite={false} />
            <Edges color={BOX_COLOR[b.kind]} />
          </mesh>
          <Html center position={[0, b.size[1] / 2 + 0.08, 0]} style={{ pointerEvents: 'none' }}>
            <div style={pill}>{b.kind} · {mmv(b.size[0])}×{mmv(b.size[2])}×{mmv(b.size[1])}</div>
          </Html>
        </group>
      ))}
      {clear}
    </>
  )
}

/** Two faint translucent 5×5 m slabs at the storeys the stair connects: the lower
 *  floor at the foot (y=0) and the upper floor at the head (y=totalRise), each
 *  centred at that end of the stair so they read as floors, not mid-span planes. */
function Storeys({ lower, upper }: { lower: [number, number, number]; upper: [number, number, number] }) {
  return (
    <>
      {[lower, upper].map((p, i) => (
        <mesh key={i} position={p} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[5, 5]} />
          <meshStandardMaterial color="#9fb4c8" transparent opacity={0.18} roughness={0.9} metalness={0} side={DoubleSide} />
        </mesh>
      ))}
    </>
  )
}

const seg: React.CSSProperties = { fontSize: 12, padding: '3px 7px', borderRadius: 5, border: '1px solid #444', background: '#2a2b2f', color: '#ddd', cursor: 'pointer' }
const segOn: React.CSSProperties = { ...seg, background: '#3b82c4', borderColor: '#3b82c4', color: '#fff' }

function TurnRow({ turn, index, onChange, onRemove }: { turn: TurnSpec; index: number; onChange: (t: TurnSpec) => void; onRemove: () => void }) {
  const up = (patch: Partial<TurnSpec>) => onChange({ ...turn, ...patch })
  return (
    <div style={{ border: '1px solid #333', borderRadius: 6, padding: 8, margin: '6px 0', background: '#212226' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <b style={{ fontSize: 12 }}>Turn {index + 1}</b>
        <button onClick={onRemove} style={{ ...seg, color: '#e57373' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button style={turn.kind === 'landing' ? segOn : seg} onClick={() => up({ kind: 'landing' })}>Landing</button>
        <button style={turn.kind === 'winder' ? segOn : seg} onClick={() => up({ kind: 'winder' })}>Winder</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Angle</span>
        <button style={turn.angle === 90 ? segOn : seg} onClick={() => up({ angle: 90 })}>90°</button>
        <button style={turn.angle === 180 ? segOn : seg} onClick={() => up({ angle: 180 })}>180°</button>
        <input type="number" value={turn.angle} min={15} max={180} step={15} style={{ width: 52, fontSize: 12 }} onChange={(e) => up({ angle: parseFloat(e.target.value) || 90 })} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 12, opacity: 0.7, alignSelf: 'center' }}>Turn</span>
        <button style={turn.direction === 'left' ? segOn : seg} onClick={() => up({ direction: 'left' })}>◀ Left</button>
        <button style={turn.direction === 'right' ? segOn : seg} onClick={() => up({ direction: 'right' })}>Right ▶</button>
      </div>
      {turn.kind === 'winder' && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          Winder steps (square corner)
          <input type="number" value={turn.winderSteps} min={2} max={4} step={1} style={{ width: 52 }} onChange={(e) => up({ winderSteps: Math.max(2, parseInt(e.target.value) || 2) })} />
        </label>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
        Steps before turn
        <input
          type="number"
          value={turn.stepsBefore ?? ''}
          placeholder="auto"
          min={0}
          max={30}
          step={1}
          style={{ width: 60 }}
          onChange={(e) => {
            const v = parseInt(e.target.value)
            up({ stepsBefore: Number.isNaN(v) ? undefined : Math.max(0, v) })
          }}
        />
      </label>
    </div>
  )
}

export function StairApp() {
  const [spec, setSpec] = useState<StairSpec>(defaultStairSpec)
  const [geo, setGeo] = useState<BufferGeometry | null>(null)
  const [boundsCenter, setBoundsCenter] = useState(() => new Vector3(0, 1, 1))
  const [setoutOpen, setSetoutOpen] = useState(false)
  const [setoutFlight, setSetoutFlight] = useState(0)
  const [setoutDatum, setSetoutDatum] = useState<'bottom' | 'top'>('bottom')
  const [showDims, setShowDims] = useState(false)
  const [boxes, setBoxes] = useState<CBox[]>(() => {
    try { return JSON.parse(localStorage.getItem('neocad-stair-boxes') || '[]') } catch { return [] }
  })
  const boxId = useRef(1 + boxes.reduce((m, b) => Math.max(m, b.id), 0))
  useEffect(() => { localStorage.setItem('neocad-stair-boxes', JSON.stringify(boxes)) }, [boxes])
  const key = stairKey(spec)
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)

  const layout = useMemo(() => layoutStair(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const { metrics, advisories } = layout
  const bom = useMemo(() => stairBom(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const setouts = useMemo(() => flightSetouts(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Storey slabs sit at the foot and head of the stair (the two floors it joins),
  // offset outward from the first/last step so they don't cut through the flights.
  const { lowerFloor, upperFloor } = useMemo(() => {
    const treads = layout.parts.filter((p) => p.kind === 'tread' && p.shape === 'box') as Array<{ center: [number, number, number] }>
    const foot = treads.reduce((lo, t) => (t.center[1] < lo.center[1] ? t : lo), treads[0])?.center ?? [0, 0, 0]
    const head = treads.reduce((hi, t) => (t.center[1] > hi.center[1] ? t : hi), treads[0])?.center ?? [0, 0, 0]
    return {
      lowerFloor: [foot[0], 0, foot[2] - 1.5] as [number, number, number],
      upperFloor: [head[0], spec.totalRise, head[2] + 1.5] as [number, number, number],
    }
  }, [layout, spec.totalRise])

  useEffect(() => {
    const node = stairToCsg(spec)
    if (!node) { setGeo(null); return }
    let alive = true
    csgToGeometry(node, manifoldWasmUrl).then((g) => {
      if (alive) setGeo((prev) => (prev?.dispose(), g))
      else g.dispose()
    })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo?.dispose(), [geo])

  const set = (patch: Partial<StairSpec>) => setSpec((s) => ({ ...s, ...patch }))
  const setStringer = (patch: Partial<StairSpec['stringer']>) => setSpec((s) => ({ ...s, stringer: { ...s.stringer, ...patch } }))
  const setRailing = (patch: Partial<StairSpec['railing']>) => setSpec((s) => ({ ...s, railing: { ...s.railing, ...patch } }))
  const addTurn = () => set({ turns: [...spec.turns, newTurn()] })
  const updateTurn = (i: number, t: TurnSpec) => set({ turns: spec.turns.map((x, j) => (j === i ? t : x)) })
  const removeTurn = (i: number) => set({ turns: spec.turns.filter((_, j) => j !== i) })

  function exportScene(): Group {
    const g = new Group()
    if (geo) g.add(new Mesh(geo, new MeshStandardMaterial({ color: '#c9a36a' })))
    return g
  }
  const onExportSTL = () => downloadBlob(new Blob([new STLExporter().parse(exportScene())], { type: 'model/stl' }), 'stair.stl')
  const onExportGLTF = () => new GLTFExporter().parse(exportScene(), (r) => {
    const blob = r instanceof ArrayBuffer ? new Blob([r], { type: 'model/gltf-binary' }) : new Blob([JSON.stringify(r)], { type: 'model/gltf+json' })
    downloadBlob(blob, 'stair.gltf')
  }, (e) => console.error('glTF export failed', e), {})
  const onDownloadBom = () => downloadBlob(new Blob([bomToCsv(bom)], { type: 'text/csv' }), 'stair-cutlist.csv')
  const onDownloadSetoutCsv = () => downloadBlob(new Blob([setoutToCsv(setouts)], { type: 'text/csv' }), 'stringer-setout.csv')
  const onDownloadSetoutSvg = (s: (typeof setouts)[number]) =>
    downloadBlob(new Blob([setoutSvg(s, setoutDatum)], { type: 'image/svg+xml' }), `stringer-flight${s.flight}-marking.svg`)

  const addBox = (kind: BoxKind) => {
    const cx = boundsCenter.x, cz = boundsCenter.z
    const H = spec.totalRise
    const presets: Record<BoxKind, CBox> = {
      floor: { id: 0, kind, size: [5, 0.2, 5], pos: [cx, -0.1, cz] },
      ceiling: { id: 0, kind, size: [5, 0.2, 5], pos: [cx, H + 0.1, cz] },
      wall: { id: 0, kind, size: [0.2, H + 0.6, 5], pos: [cx - 2.5, (H + 0.6) / 2 - 0.2, cz] },
      box: { id: 0, kind, size: [1, 1, 1], pos: [cx, 0.5, cz] },
    }
    setBoxes((bs) => [...bs, { ...presets[kind], id: boxId.current++ }])
  }
  const updateBox = (id: number, patch: Partial<CBox>) => setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  const removeBox = (id: number) => setBoxes((bs) => bs.filter((b) => b.id !== id))

  const onBounds = (c: Vector3, _r: number) => {
    setBoundsCenter((prev) => (prev.equals(c) ? prev : c.clone()))
    if (controls.current) { controls.current.target.copy(c); controls.current.update() }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 320, padding: '16px 18px', overflowY: 'auto', background: '#1b1c1f', color: '#e8e8ea', boxSizing: 'border-box' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Stair generator</h2>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Flights · turns · winders · cut list</div>

        <Slider label="Floor-to-floor rise" value={spec.totalRise} min={0.3} max={5} step={0.01} onChange={(v) => set({ totalRise: v })} />
        <Slider label="Width" value={spec.width} min={0.5} max={2} step={0.01} onChange={(v) => set({ width: v })} />
        <Slider label="Going (tread depth)" value={spec.going} min={0.15} max={0.4} step={0.005} onChange={(v) => set({ going: v })} />

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Steps</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6 }}>
          <label style={{ flex: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="radio" checked={spec.sizing.mode === 'byRise'} onChange={() => set({ sizing: { mode: 'byRise', targetRise: metrics.rise } })} /> by rise
          </label>
          <label style={{ flex: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="radio" checked={spec.sizing.mode === 'byCount'} onChange={() => set({ sizing: { mode: 'byCount', count: metrics.risers } })} /> by count
          </label>
        </div>
        {spec.sizing.mode === 'byRise' ? (
          <Slider label="Target rise" value={spec.sizing.targetRise} min={0.1} max={0.25} step={0.005} onChange={(v) => set({ sizing: { mode: 'byRise', targetRise: v } })} />
        ) : (
          <Slider label="Riser count" value={spec.sizing.count} min={2} max={40} step={1} unit="" scale={1} onChange={(v) => set({ sizing: { mode: 'byCount', count: v } })} />
        )}

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
          <span>Turns ({spec.turns.length})</span>
          <button onClick={addTurn} style={segOn}>＋ Add turn</button>
        </div>
        {spec.turns.map((t, i) => (
          <TurnRow key={t.id} turn={t} index={i} onChange={(nt) => updateTurn(i, nt)} onRemove={() => removeTurn(i)} />
        ))}
        {spec.turns.length > 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Flights: {metrics.flights.join(' · ')} steps</div>}

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Treads &amp; risers</div>
        <Slider label="Tread thickness" value={spec.treadThickness} min={0.02} max={0.08} step={0.002} onChange={(v) => set({ treadThickness: v })} />
        <Slider label="Nosing overhang" value={spec.nosing} min={0} max={0.05} step={0.002} onChange={(v) => set({ nosing: v })} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, margin: '8px 0' }}>
          <input type="checkbox" checked={spec.riserMode === 'closed'} onChange={(e) => set({ riserMode: e.target.checked ? 'closed' : 'open' })} /> Closed risers
        </label>

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Stringers (sidings)</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['none', 'two-side', 'closed', 'mono'] as StringerKind[]).map((k) => (
            <button key={k} style={spec.stringer.kind === k ? segOn : seg} onClick={() => setStringer({ kind: k })}>{k}</button>
          ))}
        </div>
        {spec.stringer.kind !== 'none' && (
          <>
            <Slider label="Stringer thickness" value={spec.stringer.thickness} min={0.02} max={0.08} step={0.002} onChange={(v) => setStringer({ thickness: v })} />
            <Slider label="Stringer depth" value={spec.stringer.depth} min={0.1} max={0.4} step={0.005} unit="mm" onChange={(v) => setStringer({ depth: v })} />
            <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, opacity: 0.7, width: 44 }}>Bottom</span>
              {(['seat', 'level', 'plumb'] as const).map((e) => (
                <button key={e} style={spec.stringer.endBottom === e ? segOn : seg} onClick={() => setStringer({ endBottom: e })}>{e}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 12, opacity: 0.7, width: 44 }}>Top</span>
              {(['plumb', 'level', 'seat'] as const).map((e) => (
                <button key={e} style={spec.stringer.endTop === e ? segOn : seg} onClick={() => setStringer({ endTop: e })}>{e}</button>
              ))}
            </div>
          </>
        )}

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Railings</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['none', 'left', 'right', 'both'] as StairSpec['railing']['sides'][]).map((k) => (
            <button key={k} style={spec.railing.sides === k ? segOn : seg} onClick={() => setRailing({ sides: k })}>{k}</button>
          ))}
        </div>
        {spec.railing.sides !== 'none' && (
          <>
            <Slider label="Handrail height" value={spec.railing.height} min={0.7} max={1.2} step={0.01} onChange={(v) => setRailing({ height: v })} />
            <Slider label="Newel post size" value={spec.railing.postSize} min={0.04} max={0.15} step={0.005} onChange={(v) => setRailing({ postSize: v })} />
            <Slider label="Baluster size" value={spec.railing.balusterSize} min={0.015} max={0.06} step={0.002} onChange={(v) => setRailing({ balusterSize: v })} />
            <Slider label="Max baluster gap" value={spec.railing.balusterGap} min={0.06} max={0.2} step={0.005} onChange={(v) => setRailing({ balusterGap: v })} />
          </>
        )}

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Material</div>
        <select value={spec.material} onChange={(e) => set({ material: e.target.value })} style={{ width: '100%', padding: 5, fontSize: 13 }}>
          {WOODS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>

        <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Readout</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div>{metrics.risers} risers · {metrics.treads} treads</div>
          <div>Rise {Math.round(metrics.rise * 1000)} mm · Going {Math.round(metrics.going * 1000)} mm</div>
          <div>Pitch {metrics.pitchDeg.toFixed(1)}° · 2R+G {Math.round(metrics.twoRplusG * 1000)} mm</div>
        </div>
        {advisories.length > 0 && (
          <ul style={{ margin: '10px 0 0', padding: '0 0 0 16px', fontSize: 12, color: '#f0b429' }}>
            {advisories.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, margin: '10px 0 0' }}>
          <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Show dimensions on model
        </label>

        <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Room / context ({boxes.length})</div>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>Add boxes for the surrounding floors, ceiling and walls — dimensions stay on screen (incl. floor→ceiling). Saved locally.</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {(['floor', 'ceiling', 'wall', 'box'] as BoxKind[]).map((k) => (
            <button key={k} style={seg} onClick={() => addBox(k)}>＋ {k}</button>
          ))}
        </div>
        {boxes.map((b) => (
          <div key={b.id} style={{ border: '1px solid #2c2d31', borderRadius: 6, padding: 7, marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <b style={{ fontSize: 12, textTransform: 'capitalize' }}>{b.kind}</b>
              <button onClick={() => removeBox(b.id)} style={{ ...seg, color: '#e57373', padding: '2px 6px' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
              {(['W', 'H', 'D'] as const).map((ax, j) => (
                <MiniNum key={ax} label={`${ax} mm`} vmm={b.size[j] * 1000} onCommit={(mm) => updateBox(b.id, { size: b.size.map((v, i) => (i === j ? mm / 1000 : v)) as [number, number, number] })} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['X', 'Y', 'Z'] as const).map((ax, j) => (
                <MiniNum key={ax} label={`${ax} mm`} vmm={b.pos[j] * 1000} onCommit={(mm) => updateBox(b.id, { pos: b.pos.map((v, i) => (i === j ? mm / 1000 : v)) as [number, number, number] })} />
              ))}
            </div>
          </div>
        ))}

        {setouts.length > 0 && (
          <>
            <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Stringer setout</span>
              <button onClick={onDownloadSetoutCsv} style={seg}>⬇ CSV</button>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6 }}>
              Marking sheet per flight — every notch as a running dimension from the bottom datum (mark each from the datum, don't add up).
            </div>
            {setouts.map((s, i) => (
              <div key={s.flight} style={{ border: '1px solid #2c2d31', borderRadius: 6, padding: 8, marginBottom: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 4 }}>
                  <b>Flight {s.flight} · {s.steps} steps</b>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => { setSetoutFlight(i); setSetoutOpen(true) }} style={segOn}>📐 View</button>
                    <button onClick={() => onDownloadSetoutSvg(s)} style={seg}>⬇</button>
                  </span>
                </div>
                <div style={{ lineHeight: 1.5, opacity: 0.85 }}>
                  <div>Rise {Math.round(s.unitRise * 1000)} · Going {Math.round(s.unitGoing * 1000)} mm</div>
                  <div>Blank {Math.round(s.blank.length * 1000)}×{Math.round(s.blank.width * 1000)}×{Math.round(s.blank.thickness * 1000)} mm</div>
                  <div>Pitch {s.pitchDeg.toFixed(1)}° · step along board {Math.round(s.hypPerStep * 1000)} mm</div>
                  <div>Drop {Math.round(s.bottomDrop * 1000)} mm · throat {Math.round(s.throat * 1000)} mm{s.throat < 0.089 ? ' ⚠ below 89' : ''}</div>
                  <div>Ends: {s.endBottom} (foot) / {s.endTop} (head)</div>
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
          <span>Cut list</span>
          <button onClick={onDownloadBom} style={seg}>⬇ CSV</button>
        </div>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', opacity: 0.6 }}><th>Part</th><th>Qty</th><th>Size</th></tr></thead>
          <tbody>
            {bom.lines.map((l, i) => (
              <tr key={i} style={{ borderTop: '1px solid #2c2d31' }}>
                <td>{l.label}</td><td>{l.qty}</td><td style={{ opacity: 0.8 }}>{l.dims}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          ≈ {bom.boardFeet.toFixed(0)} board-feet of {bom.material} ({(bom.totalVolume * 1000).toFixed(0)} L)
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onExportSTL} style={btn}>Export STL</button>
          <button onClick={onExportGLTF} style={btn}>Export glTF</button>
        </div>
      </div>

      <div style={{ flex: 1, background: '#f4f4f5', position: 'relative' }}>
        {setoutOpen && setouts.length > 0 && (
          <div style={{ position: 'absolute', inset: 12, zIndex: 1000, background: '#fff', borderRadius: 8, boxShadow: '0 6px 30px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #e5e5e5', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14, color: '#111' }}>Stringer marking template</b>
              <span style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                {setouts.map((s, i) => (
                  <button key={s.flight} onClick={() => setSetoutFlight(i)} style={i === setoutFlight ? segOn : seg}>Flight {s.flight}</button>
                ))}
              </span>
              <span style={{ display: 'flex', gap: 4, marginLeft: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#555' }}>Datum:</span>
                <button onClick={() => setSetoutDatum('bottom')} style={setoutDatum === 'bottom' ? segOn : seg}>from bottom</button>
                <button onClick={() => setSetoutDatum('top')} style={setoutDatum === 'top' ? segOn : seg}>from top</button>
              </span>
              <button onClick={() => onDownloadSetoutSvg(setouts[setoutFlight])} style={{ ...seg, marginLeft: 'auto', color: '#333', borderColor: '#ccc', background: '#f2f2f2' }}>⬇ Print SVG</button>
              <button onClick={() => setSetoutOpen(false)} style={{ ...seg, color: '#333', borderColor: '#ccc', background: '#f2f2f2' }}>✕ Close</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }} dangerouslySetInnerHTML={{ __html: setoutSvg(setouts[setoutFlight], setoutDatum) }} />
          </div>
        )}
        <Canvas
          shadows
          camera={{ position: [4.5, spec.totalRise + 2.5, metrics.totalRun + 3.5], fov: 42 }}
          gl={{ toneMapping: ACESFilmicToneMapping, antialias: true }}
        >
          <color attach="background" args={['#eef1f4']} />
          <StudioEnv />
          <hemisphereLight intensity={0.35} groundColor="#8a8578" color="#eaf2ff" />
          <directionalLight
            position={[6, 10, 5]}
            intensity={2.1}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0002}
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
          />
          <directionalLight position={[-5, 4, -4]} intensity={0.5} color="#cfe0ff" />
          <Grid args={[40, 40]} cellColor="#d2d6da" sectionColor="#b4bac0" infiniteGrid fadeDistance={45} />
          <Storeys lower={lowerFloor} upper={upperFloor} />
          {!setoutOpen && <ContextBoxes boxes={boxes} />}
          {showDims && !setoutOpen && <StepDims parts={layout.parts} />}
          {geo && <StairMesh geometry={geo} wood={spec.material} onBounds={onBounds} />}
          <OrbitControls ref={controls as never} target={[boundsCenter.x, boundsCenter.y, boundsCenter.z]} makeDefault />
        </Canvas>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { flex: 1, padding: '8px 10px', fontSize: 13, background: '#3b82c4', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }
