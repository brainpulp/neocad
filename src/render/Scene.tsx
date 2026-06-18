import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { Mesh } from 'three'
import { initJolt, type JoltModule } from '../physics/jolt'
import { PhysicsWorld } from '../physics/integration'
import { PieceMesh } from './PieceMesh'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import { HeldPiece } from './HeldPiece'
import { FastenerMarker } from './FastenerMarker'

const FIXED_DT = 1 / 60

/**
 * Stable key describing the physics-relevant structure; the world rebuilds when it
 * changes. Includes dimensions + material because they change a body's shape/mass.
 */
function structureKey(doc: import('../document/types').Document): string {
  const pieces = doc.pieces
    .map(
      (p) =>
        `${p.id}:${p.anchored ? 1 : 0}:${p.material}:${Object.values(p.dimensions).join(',')}` +
        // transform included so a committed move/rotate rebuilds the body at the new pose
        `:${p.state.transform.position.join(',')}:${p.state.transform.rotation.join(',')}`,
    )
    .join('|')
  const fasteners = doc.fasteners.map((f) => f.id).join('|')
  return `${pieces}#${fasteners}`
}

function Sim({ Jolt }: { Jolt: JoltModule }) {
  const store = useStoreApi()
  const doc = useDocStore((s) => s.doc)
  const worldEpoch = useDocStore((s) => s.worldEpoch)
  const selectedId = useDocStore((s) => s.selectedId)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const worldRef = useRef<PhysicsWorld | null>(null)
  const meshes = useRef(new Map<string, Mesh>())

  const key = `${structureKey(doc)}#${worldEpoch}`

  // (Re)build the Jolt world whenever the structure changes. Full rebuild is fine
  // for M1 (small scenes); incremental add/remove is a later-milestone optimization.
  useEffect(() => {
    worldRef.current?.dispose()
    worldRef.current = new PhysicsWorld(Jolt, store.getState().doc)
    return () => {
      worldRef.current?.dispose()
      worldRef.current = null
    }
  }, [Jolt, store, key])

  useFrame(() => {
    const world = worldRef.current
    if (!world) return
    const state = store.getState()
    if (state.running) {
      world.step(FIXED_DT)
      world.syncToDocument(state.doc)
    }
    // Drive meshes from State imperatively (no per-frame React re-render).
    for (const piece of state.doc.pieces) {
      // While the gizmo is dragging a piece, let PivotControls own its mesh.
      if (piece.id === state.transformDraggingId) continue
      const mesh = meshes.current.get(piece.id)
      if (!mesh) continue
      const [px, py, pz] = piece.state.transform.position
      const [qx, qy, qz, qw] = piece.state.transform.rotation
      mesh.position.set(px, py, pz)
      mesh.quaternion.set(qx, qy, qz, qw)
    }
  })

  return (
    <>
      {doc.pieces.map((piece) => (
        <PieceMesh
          key={piece.id}
          piece={piece}
          materials={doc.materials}
          selected={piece.id === selectedId}
          highlighted={piece.id === proximityTarget}
          onPointerMove={(e) => {
            // While placing, hovering a piece offers a join to it at the contact point.
            if (!store.getState().activeTool) return
            e.stopPropagation()
            store.getState().setHeldPos([e.point.x, e.point.y, e.point.z])
            store.getState().setProximityTarget(piece.id)
          }}
          onPointerDown={(e) => {
            const s = store.getState()
            // Pointer priority: stock placement > fastening (A→B) > selection.
            if (s.activeTool) {
              e.stopPropagation()
              // Pressing down on a piece while placing = join to it (robust even
              // without a preceding hover, e.g. touch).
              s.setProximityTarget(piece.id)
              s.commitHeldAt([e.point.x, e.point.y, e.point.z]) // auto-joins to proximityTarget
              return
            }
            if (s.fastenTool) {
              e.stopPropagation()
              s.fastenClick(piece.id)
              return
            }
            e.stopPropagation()
            s.select(piece.id)
          }}
          ref={(m) => {
            if (m) meshes.current.set(piece.id, m)
            else meshes.current.delete(piece.id)
          }}
        />
      ))}
      {doc.fasteners.map((f) => (
        <FastenerMarker key={f.id} fastener={f} />
      ))}
    </>
  )
}

export function Scene() {
  // Load Jolt once; render the simulation only after the WASM module is ready.
  const joltRef = useRef<JoltModule | null>(null)
  const ready = useJolt(joltRef)
  const store = useStoreApi()

  return (
    <Canvas
      shadows
      camera={{ position: [3, 2.5, 4], fov: 50 }}
      onPointerMissed={() => store.getState().select(null)}
    >
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Grid args={[40, 40]} cellSize={0.5} sectionSize={2} infiniteGrid fadeDistance={30} />
      {ready && joltRef.current && <Sim Jolt={joltRef.current} />}
      <HeldPiece />
      <OrbitControls makeDefault />
    </Canvas>
  )
}

// Small hook: resolve the Jolt module and trigger a re-render when ready.
import { useState } from 'react'
function useJolt(ref: React.MutableRefObject<JoltModule | null>): boolean {
  const [ready, setReady] = useState(false)
  useMemo(() => {
    initJolt().then((J) => {
      ref.current = J
      setReady(true)
    })
  }, [ref])
  return ready
}
