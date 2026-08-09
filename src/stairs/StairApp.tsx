import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
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
    downloadBlob(new Blob([setoutSvg(s)], { type: 'image/svg+xml' }), `stringer-flight${s.flight}-marking.svg`)

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

        {setouts.length > 0 && (
          <>
            <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
              <span>Stringer setout</span>
              <button onClick={onDownloadSetoutCsv} style={seg}>⬇ CSV</button>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6 }}>
              Marking sheet per flight — every notch as a running dimension from the bottom datum (mark each from the datum, don't add up).
            </div>
            {setouts.map((s) => (
              <div key={s.flight} style={{ border: '1px solid #2c2d31', borderRadius: 6, padding: 8, marginBottom: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <b>Flight {s.flight} · {s.steps} steps</b>
                  <button onClick={() => onDownloadSetoutSvg(s)} style={segOn}>⬇ Marking sheet</button>
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

      <div style={{ flex: 1, background: '#f4f4f5' }}>
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
          {geo && <StairMesh geometry={geo} wood={spec.material} onBounds={onBounds} />}
          <OrbitControls ref={controls as never} target={[boundsCenter.x, boundsCenter.y, boundsCenter.z]} makeDefault />
        </Canvas>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { flex: 1, padding: '8px 10px', fontSize: 13, background: '#3b82c4', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }
