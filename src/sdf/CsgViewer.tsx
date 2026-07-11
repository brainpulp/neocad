import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ACESFilmicToneMapping, type BufferGeometry } from 'three'
// Vite serves the wasm and hands us its URL; manifold loads it at runtime.
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  csgBox,
  csgCylinder,
  csgSubtract,
  csgToGeometry,
  csgTransform,
  type CsgNode,
} from './csg'

/** Renders a CSG tree as a real (watertight) mesh, re-meshing whenever the tree
 * changes. A request counter drops stale async results so fast slider drags
 * always land on the latest shape. Reports triangle count + solve time. */
function CsgMesh({
  node,
  onStats,
}: {
  node: CsgNode
  onStats?: (s: { tris: number; ms: number }) => void
}) {
  const [geo, setGeo] = useState<BufferGeometry | null>(null)
  const reqId = useRef(0)
  useEffect(() => {
    const id = ++reqId.current
    const t0 = performance.now()
    csgToGeometry(node, wasmUrl).then((g) => {
      if (id !== reqId.current) {
        g.dispose()
        return
      }
      setGeo((prev) => {
        prev?.dispose()
        return g
      })
      onStats?.({ tris: (g.index?.count ?? 0) / 3, ms: performance.now() - t0 })
    })
    // onStats intentionally omitted from deps (stable enough for a dev demo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node])
  if (!geo) return null
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      {/* Flat shading: crisp facets — manifold welds edge verts, so averaged
          normals would smooth the sharp cuts into blobs. */}
      <meshStandardMaterial color="#d99a45" metalness={0.15} roughness={0.55} flatShading />
    </mesh>
  )
}

const label: React.CSSProperties = { display: 'block', marginTop: 10, fontSize: 12, opacity: 0.85 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

function Slider({
  name,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  name: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
}) {
  return (
    <label style={label}>
      <div style={row}>
        <span style={{ width: 92 }}>{name}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
    </label>
  )
}

/** Dev-only INTERACTIVE exact-CSG playground at `?csg`. Drill a resizable bore
 * (or two crossing bores) through a resizable block and watch it re-cut live. */
export function CsgApp() {
  const [size, setSize] = useState(2)
  const [dia, setDia] = useState(0.9)
  const [bx, setBx] = useState(0)
  const [bz, setBz] = useState(0)
  const [cross, setCross] = useState(false)
  const [stats, setStats] = useState<{ tris: number; ms: number } | null>(null)

  const node = useMemo<CsgNode>(() => {
    const through = size * 2 + 1 // guarantee the bore passes fully through
    let n: CsgNode = csgSubtract(
      csgBox([size, size, size]),
      csgTransform(csgCylinder(dia / 2, through, 64), { translate: [bx, 0, bz] }),
    )
    if (cross) {
      // A second bore along X (rotate the Y-axis cylinder 90° about Z).
      n = csgSubtract(
        n,
        csgTransform(csgCylinder(dia / 2, through, 64), { rotate: [0, 0, 90], translate: [0, bz, 0] }),
      )
    }
    return n
  }, [size, dia, bx, bz, cross])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e9edf2' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 10,
          width: 250,
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid #cdd6e0',
          borderRadius: 8,
          color: '#33465c',
          font: '13px/1.4 system-ui, sans-serif',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        }}
      >
        <strong>NeoCad · live drilling</strong>
        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
          exact manifold-3d boolean · watertight
        </div>
        <Slider name="Block" value={size} min={1} max={3} step={0.05} onChange={setSize} fmt={(v) => v.toFixed(1)} />
        <Slider name="Bore Ø" value={dia} min={0.1} max={2} step={0.02} onChange={setDia} />
        <Slider name="Bore X" value={bx} min={-1.2} max={1.2} step={0.02} onChange={setBx} />
        <Slider name="Bore Z" value={bz} min={-1.2} max={1.2} step={0.02} onChange={setBz} />
        <label style={{ ...label, ...row }}>
          <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} />
          <span>Add crossing bore</span>
        </label>
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
          {stats ? `${stats.tris} triangles · re-cut in ${stats.ms.toFixed(0)} ms` : 'meshing…'}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.55 }}>drag to orbit · scroll to zoom</div>
      </div>
      <Canvas
        shadows
        camera={{ position: [3.4, 2.6, 3.8], fov: 45 }}
        gl={{ toneMapping: ACESFilmicToneMapping }}
      >
        <color attach="background" args={['#e9edf2']} />
        <hemisphereLight args={['#ffffff', '#b8c0cc', 0.7]} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />
        <CsgMesh node={node} onStats={setStats} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
