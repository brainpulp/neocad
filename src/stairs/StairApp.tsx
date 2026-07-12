import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import {
  ACESFilmicToneMapping,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import { csgToGeometry } from '../render/csg'
import { downloadBlob } from '../persistence/file'
import { defaultStairSpec, type StairSpec } from './spec'
import { layoutStair } from './layout'
import { stairToCsg, stairKey } from './build'

/**
 * Standalone stair-generator playground (`?stairs`). A parameter panel drives the
 * pure layout + manifold mesher live; the exact solid re-meshes on change (falling
 * back to the previous mesh while pending) and exports to STL/glTF. S0 = a single
 * straight flight; turns/winders/spiral land in later slices.
 */

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = 'mm',
  scale = 1000,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  scale?: number
  onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'block', margin: '10px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ opacity: 0.7 }}>
          {Math.round(value * scale)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ width: '100%' }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

function StairMesh({ geometry }: { geometry: BufferGeometry }) {
  const material = useMemo(
    () => new MeshStandardMaterial({ color: '#c9a36a', roughness: 0.7, metalness: 0.05 }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

export function StairApp() {
  const [spec, setSpec] = useState<StairSpec>(defaultStairSpec)
  const [geo, setGeo] = useState<BufferGeometry | null>(null)
  const key = stairKey(spec)

  const { metrics, advisories } = useMemo(() => layoutStair(spec), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-mesh the exact solid whenever a geometry parameter changes; keep the last
  // mesh on screen while the new one bakes (manifold is ~10–30 ms).
  useEffect(() => {
    const node = stairToCsg(spec)
    if (!node) {
      setGeo(null)
      return
    }
    let alive = true
    csgToGeometry(node, manifoldWasmUrl).then((g) => {
      if (alive) setGeo((prev) => (prev?.dispose(), g))
      else g.dispose()
    })
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo?.dispose(), [geo])

  const set = (patch: Partial<StairSpec>) => setSpec((s) => ({ ...s, ...patch }))

  function exportScene(): Group {
    const g = new Group()
    if (geo) g.add(new Mesh(geo, new MeshStandardMaterial({ color: '#c9a36a' })))
    return g
  }
  function onExportSTL() {
    const stl = new STLExporter().parse(exportScene())
    downloadBlob(new Blob([stl], { type: 'model/stl' }), 'stair.stl')
  }
  function onExportGLTF() {
    new GLTFExporter().parse(
      exportScene(),
      (result) => {
        const blob =
          result instanceof ArrayBuffer
            ? new Blob([result], { type: 'model/gltf-binary' })
            : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' })
        downloadBlob(blob, 'stair.gltf')
      },
      (e) => console.error('glTF export failed', e),
      {},
    )
  }

  const centerY = spec.totalRise / 2
  const centerZ = metrics.totalRun / 2

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          width: 300,
          padding: '16px 18px',
          overflowY: 'auto',
          background: '#1b1c1f',
          color: '#e8e8ea',
          boxSizing: 'border-box',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Stair generator</h2>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Straight flight · S0</div>

        <Slider label="Floor-to-floor rise" value={spec.totalRise} min={0.3} max={5} step={0.01} onChange={(v) => set({ totalRise: v })} />
        <Slider label="Width" value={spec.width} min={0.5} max={2} step={0.01} onChange={(v) => set({ width: v })} />
        <Slider label="Going (tread depth)" value={spec.going} min={0.15} max={0.4} step={0.005} onChange={(v) => set({ going: v })} />

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Steps</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6 }}>
          <label style={{ flex: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="radio" checked={spec.sizing.mode === 'byRise'} onChange={() => set({ sizing: { mode: 'byRise', targetRise: metrics.rise } })} />
            by rise
          </label>
          <label style={{ flex: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="radio" checked={spec.sizing.mode === 'byCount'} onChange={() => set({ sizing: { mode: 'byCount', count: metrics.risers } })} />
            by count
          </label>
        </div>
        {spec.sizing.mode === 'byRise' ? (
          <Slider label="Target rise" value={spec.sizing.targetRise} min={0.1} max={0.25} step={0.005} onChange={(v) => set({ sizing: { mode: 'byRise', targetRise: v } })} />
        ) : (
          <Slider label="Riser count" value={spec.sizing.count} min={2} max={30} step={1} unit="" scale={1} onChange={(v) => set({ sizing: { mode: 'byCount', count: v } })} />
        )}

        <div style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Treads &amp; risers</div>
        <Slider label="Tread thickness" value={spec.treadThickness} min={0.02} max={0.08} step={0.002} onChange={(v) => set({ treadThickness: v })} />
        <Slider label="Nosing overhang" value={spec.nosing} min={0} max={0.05} step={0.002} onChange={(v) => set({ nosing: v })} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, margin: '8px 0' }}>
          <input type="checkbox" checked={spec.riserMode === 'closed'} onChange={(e) => set({ riserMode: e.target.checked ? 'closed' : 'open' })} />
          Closed risers
        </label>
        {spec.riserMode === 'closed' && (
          <Slider label="Riser thickness" value={spec.riserThickness} min={0.01} max={0.05} step={0.002} onChange={(v) => set({ riserThickness: v })} />
        )}

        <div style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>Readout</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div>{metrics.risers} risers · {metrics.treads} treads</div>
          <div>Rise {Math.round(metrics.rise * 1000)} mm · Going {Math.round(metrics.going * 1000)} mm</div>
          <div>Pitch {metrics.pitchDeg.toFixed(1)}° · Run {(metrics.totalRun).toFixed(2)} m</div>
          <div>2R+G {Math.round(metrics.twoRplusG * 1000)} mm</div>
        </div>
        {advisories.length > 0 && (
          <ul style={{ margin: '10px 0 0', padding: '0 0 0 16px', fontSize: 12, color: '#f0b429' }}>
            {advisories.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onExportSTL} style={btn}>Export STL</button>
          <button onClick={onExportGLTF} style={btn}>Export glTF</button>
        </div>
      </div>

      <div style={{ flex: 1, background: '#f4f4f5' }}>
        <Canvas
          shadows
          camera={{ position: [3.5, spec.totalRise + 1, metrics.totalRun + 3], fov: 45 }}
          gl={{ toneMapping: ACESFilmicToneMapping }}
        >
          <hemisphereLight intensity={0.6} groundColor="#b0b0b0" />
          <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />
          <Grid args={[20, 20]} cellColor="#c8c8c8" sectionColor="#a0a0a0" infiniteGrid fadeDistance={30} position={[0, 0, 0]} />
          {geo && <StairMesh geometry={geo} />}
          <OrbitControls target={[0, centerY, centerZ]} makeDefault />
        </Canvas>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  fontSize: 13,
  background: '#3b82c4',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}
