import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import type { Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { initJolt, type JoltModule } from '../physics/jolt'
import { PhysicsWorld } from '../physics/integration'
import { PieceMesh } from './PieceMesh'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import { HeldPiece } from './HeldPiece'
import { FastenerMarker } from './FastenerMarker'
import { FeatureMarker } from './FeatureMarker'
import { ResizeHandles } from './ResizeHandles'
import { STOCK } from '../document/catalog'
import type { Vec3 } from '../document/types'

const FIXED_DT = 1 / 60

/**
 * Stable key describing the physics-relevant structure; the world rebuilds when it
 * changes. Includes dimensions + material because they change a body's shape/mass.
 */
function structureKey(doc: import('../document/types').Document): string {
  const pieces = doc.pieces
    .map((p) => `${p.id}:${p.anchored ? 1 : 0}:${p.material}:${Object.values(p.dimensions).join(',')}`)
    .join('|')
  const fasteners = doc.fasteners.map((f) => f.id).join('|')
  return `${pieces}#${fasteners}`
}

interface DragState {
  id: string
  /** Pointer-hit offset from the piece center at grab time (XZ). */
  offX: number
  offZ: number
  /** The piece keeps this height while dragged across the canvas. */
  centerY: number
  /** Height of the invisible drag plane (where the pointer grabbed). */
  planeY: number
  target: Vec3
}

function Sim({ Jolt }: { Jolt: JoltModule }) {
  const store = useStoreApi()
  const doc = useDocStore((s) => s.doc)
  const worldEpoch = useDocStore((s) => s.worldEpoch)
  const selectedId = useDocStore((s) => s.selectedId)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const running = useDocStore((s) => s.running)
  const tool = useDocStore((s) => s.tool)
  const gizmoMode = useDocStore((s) => s.gizmoMode)
  const jointA = useDocStore((s) => s.jointA)
  const jointHover = useDocStore((s) => s.jointHover)
  const worldRef = useRef<PhysicsWorld | null>(null)
  const meshes = useRef(new Map<string, Mesh>())
  const drag = useRef<DragState | null>(null)
  // Pointer is over a resize handle: mute the gizmo so it can't steal the drag.
  const [handleHover, setHandleHover] = useState(false)

  const key = `${structureKey(doc)}#${worldEpoch}`

  // (Re)build the Jolt world whenever the structure changes. Full rebuild is fine
  // for M1 (small scenes); incremental add/remove is a later-milestone optimization.
  useEffect(() => {
    drag.current = null
    store.getState().setDraggingId(null)
    worldRef.current?.dispose()
    worldRef.current = new PhysicsWorld(Jolt, store.getState().doc)
    return () => {
      worldRef.current?.dispose()
      worldRef.current = null
    }
  }, [Jolt, store, key])

  // The paused-mode gizmo owns the selected mesh's transform; the frame loop must
  // not overwrite it while the user drags handles.
  const gizmoActive = !running && tool === 'transform' && !!selectedId
  const gizmoMesh = gizmoActive && selectedId ? meshes.current.get(selectedId) : undefined

  useFrame(() => {
    const world = worldRef.current
    if (!world) return
    const state = store.getState()
    if (state.running) {
      if (drag.current) world.moveGrab(drag.current.id, drag.current.target, FIXED_DT)
      world.step(FIXED_DT)
      world.syncToDocument(state.doc)
    }
    // Drive meshes from State imperatively (no per-frame React re-render).
    for (const piece of state.doc.pieces) {
      if (gizmoActive && piece.id === state.selectedId) continue
      const mesh = meshes.current.get(piece.id)
      if (!mesh) continue
      const [px, py, pz] = piece.state.transform.position
      const [qx, qy, qz, qw] = piece.state.transform.rotation
      mesh.position.set(px, py, pz)
      mesh.quaternion.set(qx, qy, qz, qw)
    }
  })

  const endDrag = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    worldRef.current?.endGrab(d.id)
    store.getState().setDraggingId(null)
    // Record the release point as the piece's new rest placement (undoable).
    const piece = store.getState().doc.pieces.find((p) => p.id === d.id)
    if (piece) {
      store.getState().updatePiece(d.id, {
        definition: { transform: structuredClone(piece.state.transform) },
      })
    }
  }

  // Commit a finished gizmo drag back into the document.
  const commitGizmo = () => {
    const s = store.getState()
    const id = s.selectedId
    if (!id) return
    const mesh = meshes.current.get(id)
    const piece = s.doc.pieces.find((p) => p.id === id)
    if (!mesh || !piece) return
    if (s.gizmoMode === 'scale') {
      const { x: sx, y: sy, z: sz } = mesh.scale
      const d = { ...piece.dimensions }
      switch (STOCK[piece.stockType].primitive) {
        case 'box':
          d.x *= sx
          d.y *= sy
          d.z *= sz
          break
        case 'cylinder':
          d.radius *= (sx + sz) / 2
          d.height *= sy
          break
        case 'sphere':
          d.radius *= (sx + sy + sz) / 3
          break
      }
      mesh.scale.set(1, 1, 1)
      s.updatePiece(id, { dimensions: d }) // dimension change rebuilds the world
      // Keep the piece where the gizmo left it as well.
      s.movePieceTransform(id, {
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
      })
      return
    }
    s.movePieceTransform(id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    })
  }

  return (
    <>
      {doc.pieces.map((piece) => (
        <PieceMesh
          key={piece.id}
          piece={piece}
          materials={doc.materials}
          selected={piece.id === selectedId}
          highlighted={piece.id === proximityTarget || piece.id === jointA?.pieceId}
          onPointerMove={(e) => {
            const s = store.getState()
            // While placing, hovering a piece offers a join to it at the contact point.
            if (s.activeTool) {
              e.stopPropagation()
              s.setHeldPos([e.point.x, e.point.y, e.point.z])
              s.setProximityTarget(piece.id)
              return
            }
            // Joint tool: live snap preview of the feature under the pointer.
            if (s.tool === 'joint') {
              e.stopPropagation()
              s.jointHoverAt(piece.id, [e.point.x, e.point.y, e.point.z])
              return
            }
            // Dragging: slide the piece along the horizontal plane it was grabbed on.
            const d = drag.current
            if (d && d.id === piece.id && e.ray.direction.y !== 0) {
              const t = (d.planeY - e.ray.origin.y) / e.ray.direction.y
              if (t > 0) {
                const hx = e.ray.origin.x + e.ray.direction.x * t
                const hz = e.ray.origin.z + e.ray.direction.z * t
                d.target = [hx - d.offX, d.centerY, hz - d.offZ]
              }
            }
          }}
          onPointerDown={(e) => {
            const s = store.getState()
            // Pointer priority: stock placement > joint picking > fastening (A→B) > drag/select.
            if (s.activeTool) {
              e.stopPropagation()
              // Pressing down on a piece while placing = join to it (robust even
              // without a preceding hover, e.g. touch).
              s.setProximityTarget(piece.id)
              s.commitHeldAt([e.point.x, e.point.y, e.point.z])
              return
            }
            if (s.tool === 'joint') {
              e.stopPropagation()
              s.jointClick(piece.id, [e.point.x, e.point.y, e.point.z])
              return
            }
            if (s.fastenTool) {
              e.stopPropagation()
              s.fastenClick(piece.id)
              return
            }
            e.stopPropagation()
            s.select(piece.id)
            // Default tool while the sim runs: drag the piece across the canvas.
            if (s.running && s.tool === 'transform' && !piece.anchored) {
              if (worldRef.current?.beginGrab(piece.id)) {
                const [cx, cy, cz] = piece.state.transform.position
                drag.current = {
                  id: piece.id,
                  offX: e.point.x - cx,
                  offZ: e.point.z - cz,
                  centerY: cy,
                  planeY: e.point.y,
                  target: [cx, cy, cz],
                }
                s.setDraggingId(piece.id)
                ;(e.target as Element).setPointerCapture(e.pointerId)
              }
            }
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endDrag()
            }
          }}
          onPointerOut={() => {
            const s = store.getState()
            if (s.jointHover?.pieceId === piece.id) s.jointHoverAt(null)
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
      {/* Joint tool: snap preview under the pointer + the picked point A. */}
      {jointHover && jointHover.pieceId !== jointA?.pieceId && (
        <FeatureMarker anchor={jointHover} color="#2ecc71" />
      )}
      {jointA && <FeatureMarker anchor={jointA} color="#ff8a00" />}
      {/* Paused + transform tool: move/rotate gizmo + Tinkercad resize handles. */}
      {gizmoMesh && (
        <TransformControls
          object={gizmoMesh}
          mode={gizmoMode}
          enabled={!handleHover}
          onMouseUp={commitGizmo}
        />
      )}
      {gizmoMesh && selectedId && (
        <ResizeHandles
          piece={doc.pieces.find((p) => p.id === selectedId)!}
          mesh={gizmoMesh}
          onHoverChange={setHandleHover}
        />
      )}
    </>
  )
}

// Dev-only hook so e2e scripts can project world→screen through the live camera.
function DevCameraHook() {
  const camera = useThree((s) => s.camera)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__camera = camera
  }
  return null
}

export function Scene() {
  // Load Jolt once; render the simulation only after the WASM module is ready.
  const joltRef = useRef<JoltModule | null>(null)
  const ready = useJolt(joltRef)
  const store = useStoreApi()
  const draggingId = useDocStore((s) => s.draggingId)
  const orbitRef = useRef<OrbitControlsImpl | null>(null)

  return (
    <Canvas
      shadows
      camera={{ position: [3.5, 2.6, 4.5], fov: 45 }}
      onPointerMissed={() => {
        store.getState().select(null)
        store.getState().cancelJoint()
      }}
    >
      {/* Tinkercad-style presentation: white background, soft sky light, one
          gentle key light with soft shadows, and a light blue-grey grid. */}
      <color attach="background" args={['#ffffff']} />
      <hemisphereLight args={['#ffffff', '#b8c0cc', 0.85]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-6, 5, -6]} intensity={0.3} />
      {/* Shadow catcher just under the grid so shadows read on the white ground. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
      <Grid
        args={[40, 40]}
        cellSize={0.5}
        sectionSize={2}
        cellColor="#dde3ea"
        sectionColor="#b6c2d0"
        infiniteGrid
        fadeDistance={30}
      />
      <DevCameraHook />
      {ready && joltRef.current && <Sim Jolt={joltRef.current} />}
      <HeldPiece />
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enabled={!draggingId}
        // Keep the camera above the workplane — no diving underground.
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={0.5}
        maxDistance={60}
        onChange={() => {
          const c = orbitRef.current
          if (c && c.target.y < 0.02) {
            c.target.y = 0.02
          }
        }}
      />
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
