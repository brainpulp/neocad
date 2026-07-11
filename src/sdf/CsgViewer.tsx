import { useEffect, useMemo, useState } from 'react'
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

/** Exact-boolean demos, switchable via `?csg=<name>`. These are REAL meshes
 * (manifold output), rendered lit — sharp edges, watertight, low-poly. */
export const CSG_DEMOS: Record<string, { title: string; node: CsgNode }> = {
  drill: {
    title: 'block − Ø bore (exact, watertight)',
    node: csgSubtract(csgBox([2, 2, 2]), csgCylinder(0.5, 4)),
  },
  scoop: {
    title: 'block − offset bore (blind hole)',
    node: csgSubtract(csgBox([2, 2, 2]), csgTransform(csgCylinder(0.6, 2.4), { translate: [0, 0.5, 0] })),
  },
  cross: {
    title: 'block − two crossing bores',
    node: csgSubtract(
      csgSubtract(csgBox([2, 2, 2]), csgCylinder(0.35, 5)),
      csgTransform(csgCylinder(0.35, 5), { rotate: [0, 0, 90] }),
    ),
  },
  dice: {
    title: 'block − 5 pip bores',
    node: [
      [0.55, 0.55],
      [-0.55, 0.55],
      [0.55, -0.55],
      [-0.55, -0.55],
      [0, 0],
    ].reduce<CsgNode>(
      (solid, [x, z]) =>
        csgSubtract(solid, csgTransform(csgCylinder(0.26, 0.7), { translate: [x, 0.85, z] })),
      csgBox([2, 2, 2]),
    ),
  },
}

function pickDemo() {
  const q = new URLSearchParams(window.location.search).get('csg') || ''
  const name = CSG_DEMOS[q] ? q : 'drill'
  return { name, ...CSG_DEMOS[name] }
}

function CsgMesh({ node }: { node: CsgNode }) {
  const [geo, setGeo] = useState<BufferGeometry | null>(null)
  useEffect(() => {
    let alive = true
    csgToGeometry(node, wasmUrl).then((g) => {
      if (alive) setGeo(g)
      else g.dispose()
    })
    return () => {
      alive = false
    }
  }, [node])
  if (!geo) return null
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      {/* Flat shading: crisp faceted faces (manifold welds edge verts, so
          averaged normals would smooth the sharp cuts into blobs). */}
      <meshStandardMaterial color="#d99a45" metalness={0.15} roughness={0.55} flatShading />
    </mesh>
  )
}

/** Dev-only exact-CSG preview. Reached via `?csg` (default) or `?csg=<name>`. */
export function CsgApp() {
  const demo = useMemo(() => pickDemo(), [])
  const names = Object.keys(CSG_DEMOS)
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e9edf2' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 10,
          color: '#33465c',
          font: '13px/1.5 system-ui, sans-serif',
        }}
      >
        <strong>NeoCad · exact CSG (manifold-3d)</strong>
        <div style={{ opacity: 0.75 }}>
          {demo.name} — {demo.title}
        </div>
        <div style={{ opacity: 0.6, marginTop: 6 }}>watertight mesh · drag to orbit · scroll to zoom</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {names.map((n) => (
            <a
              key={n}
              href={`?csg=${n}`}
              style={{
                color: n === demo.name ? '#c67b12' : '#5b6b7e',
                textDecoration: 'none',
                borderBottom: n === demo.name ? '1px solid #c67b12' : '1px solid transparent',
              }}
            >
              {n}
            </a>
          ))}
        </div>
      </div>
      <Canvas
        shadows
        camera={{ position: [3.4, 2.6, 3.8], fov: 45 }}
        gl={{ toneMapping: ACESFilmicToneMapping }}
      >
        <color attach="background" args={['#e9edf2']} />
        <hemisphereLight args={['#ffffff', '#b8c0cc', 0.7]} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />
        <CsgMesh node={demo.node} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
