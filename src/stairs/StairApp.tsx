import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import {
  ACESFilmicToneMapping,
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import { csgToGeometry } from '../render/csg'
import { downloadBlob } from '../persistence/file'
import { defaultStairSpec, newTurn, type StairSpec, type StringerKind, type TurnSpec } from './spec'
import { layoutStair } from './layout'
import { stairToCsg, stairKey } from './build'
import { stairBom, bomToCsv } from './bom'

/**
 * Standalone stair-generator playground (`?stairs`). Parameters drive the pure
 * layout + manifold mesher live; turns (landings/winders) split the walk into
 * flights, stringers spec the sidings, and a cut list orders the wood. The exact
 * solid re-meshes on change (falling back to the previous mesh while pending) and
 * exports to STL/glTF.
 */

const WOODS = ['pine', 'oak', 'walnut', 'plywood', 'bamboo', 'mdf', 'maple']

/**
 * A labelled control with BOTH a range slider and a typeable number box (shown in
 * display units, e.g. mm). Tab moves between the number boxes; focusing one
 * selects its text so you can Tab-then-type to punch an exact value.
 */
function Slider({ label, value, min, max, step, unit = 'mm', scale = 1000, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const disp = Math.round(value * scale * 1000) / 1000
  return (
    <label style={{ display: 'block', margin: '9px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            value={disp}
            min={min * scale}
            max={max * scale}
            step={step * scale}
            onFocus={(e) => e.target.select()}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(clamp(v / scale)) }}
            style={{ width: 62, fontSize: 12, textAlign: 'right', background: '#2a2b2f', color: '#e8e8ea', border: '1px solid #444', borderRadius: 4, padding: '2px 4px' }}
          />
          <span style={{ opacity: 0.6, width: 20 }}>{unit}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: '100%' }} tabIndex={-1} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  )
}

function StairMesh({ geometry, onBounds }: { geometry: BufferGeometry; onBounds: (c: Vector3, r: number) => void }) {
  const material = useMemo(() => new MeshStandardMaterial({ color: '#c9a36a', roughness: 0.7, metalness: 0.05 }), [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    const c = new Vector3(); box.getCenter(c)
    onBounds(c, box.getSize(new Vector3()).length() / 2)
  }, [geometry, onBounds])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
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
      {turn.kind === 'landing' ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7, alignSelf: 'center' }}>Descanso</span>
          <button style={turn.landingShape === 'square' ? segOn : seg} onClick={() => up({ landingShape: 'square' })}>Square</button>
          <button style={turn.landingShape === 'triangular' ? segOn : seg} onClick={() => up({ landingShape: 'triangular' })}>Triangular</button>
        </div>
      ) : (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          Winder steps
          <input type="number" value={turn.winderSteps} min={2} max={6} step={1} style={{ width: 52 }} onChange={(e) => up({ winderSteps: Math.max(2, parseInt(e.target.value) || 3) })} />
        </label>
      )}
    </div>
  )
}

export function StairApp() {
  const [spec, setSpec] = useState<StairSpec>(defaultStairSpec)
  const [geo, setGeo] = useState<BufferGeometry | null>(null)
  const key = stairKey(spec)
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)

  const { metrics, advisories } = useMemo(() => layoutStair(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const bom = useMemo(() => stairBom(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const onBounds = (c: Vector3, _r: number) => {
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
        <Canvas shadows camera={{ position: [4, spec.totalRise + 2, metrics.totalRun + 3], fov: 45 }} gl={{ toneMapping: ACESFilmicToneMapping }}>
          <hemisphereLight intensity={0.6} groundColor="#b0b0b0" />
          <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />
          <Grid args={[30, 30]} cellColor="#c8c8c8" sectionColor="#a0a0a0" infiniteGrid fadeDistance={40} />
          {geo && <StairMesh geometry={geo} onBounds={onBounds} />}
          <OrbitControls ref={controls as never} target={[0, spec.totalRise / 2, metrics.totalRun / 2]} makeDefault />
        </Canvas>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { flex: 1, padding: '8px 10px', fontSize: 13, background: '#3b82c4', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }
