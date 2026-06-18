import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { Mesh } from 'three'
import { initJolt, type JoltModule } from '../physics/jolt'
import { PhysicsWorld } from '../physics/integration'
import { PieceMesh } from './PieceMesh'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import { HeldPiece } from './HeldPiece'

const FIXED_DT = 1 / 60

/** Stable key describing the physics-relevant structure; world rebuilds when it changes. */
function structureKey(doc: { pieces: { id: string; anchored: boolean }[]; fasteners: { id: string }[] }): string {
  const pieces = doc.pieces.map((p) => `${p.id}:${p.anchored ? 1 : 0}`).join('|')
  const fasteners = doc.fasteners.map((f) => f.id).join('|')
  return `${pieces}#${fasteners}`
}

function Sim({ Jolt }: { Jolt: JoltModule }) {
  const store = useStoreApi()
  const doc = useDocStore((s) => s.doc)
  const worldEpoch = useDocStore((s) => s.worldEpoch)
  const selectedId = useDocStore((s) => s.selectedId)
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
          onPointerDown={(e) => {
            // Pointer priority: stock placement > selection. (Fastening added in T7.)
            if (store.getState().activeTool) return
            e.stopPropagation()
            store.getState().select(piece.id)
          }}
          ref={(m) => {
            if (m) meshes.current.set(piece.id, m)
            else meshes.current.delete(piece.id)
          }}
        />
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
