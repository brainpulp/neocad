import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls, TransformControls } from '@react-three/drei'
import { Quaternion, Vector3, type Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { initJolt, type JoltModule } from '../physics/jolt'
import { PhysicsWorld } from '../physics/integration'
import { PieceMesh } from './PieceMesh'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import { HeldPiece } from './HeldPiece'
import { FastenerMarker } from './FastenerMarker'
import { FeatureMarker } from './FeatureMarker'
import { ResizeHandles } from './ResizeHandles'
import { JointEditor } from './JointEditor'
import { localDirToWorld, localToWorld } from '../document/math'
import { isJointType, type Vec3 } from '../document/types'
import { maxExtent } from './geometry'
import { playImpact } from '../audio/impacts'

const FIXED_DT = 1 / 60
const UP = new Vector3(0, 1, 0)

/**
 * Stable key describing the physics-relevant structure; the world rebuilds when it
 * changes. Includes dimensions + material because they change a body's shape/mass.
 */
function structureKey(doc: import('../document/types').Document): string {
  const pieces = doc.pieces
    .map((p) => `${p.id}:${p.anchored ? 1 : 0}:${p.material}:${Object.values(p.dimensions).join(',')}`)
    .join('|')
  const fasteners = doc.fasteners.map((f) => f.id).join('|')
  const sb = doc.ground.sandbox
  return `${pieces}#${fasteners}#sb:${sb ? `${sb.size},${sb.thickness}` : 'none'}`
}

/** Param along a line (origin, unit dir) closest to a pointer ray. */
function lineParam(origin: Vector3, dir: Vector3, rayOrigin: Vector3, rayDir: Vector3): number | null {
  const b = dir.dot(rayDir)
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-6) return null
  const w = origin.clone().sub(rayOrigin)
  return (b * rayDir.dot(w) - dir.dot(w)) / denom
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
  /** planeY − centerY, kept constant when shift-lifting rebases the plane. */
  grabOffY: number
  target: Vec3
}

interface PausedDrag {
  id: string
  /** free = ground-plane move; slide/swing = constrained to the piece's joint. */
  mode: 'free' | 'slide' | 'swing'
  offX: number
  offZ: number
  centerY: number
  planeY: number
  grabOffY: number
  axis?: Vector3
  startParam?: number
  startPos?: Vector3
  minD?: number
  maxD?: number
  anchor?: Vector3
  startVec?: Vector3
  quat0?: Quaternion
  center0?: Vector3
}

function Sim({ Jolt }: { Jolt: JoltModule }) {
  const store = useStoreApi()
  const doc = useDocStore((s) => s.doc)
  const worldEpoch = useDocStore((s) => s.worldEpoch)
  const selectedId = useDocStore((s) => s.selectedId)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const running = useDocStore((s) => s.running)
  const tool = useDocStore((s) => s.tool)
  const jointA = useDocStore((s) => s.jointA)
  const jointHover = useDocStore((s) => s.jointHover)
  const worldRef = useRef<PhysicsWorld | null>(null)
  const meshes = useRef(new Map<string, Mesh>())
  const drag = useRef<DragState | null>(null)
  const pausedDrag = useRef<PausedDrag | null>(null)
  // Pointer is over a resize handle: mute the gizmo so it can't steal the drag.
  const [handleHover, setHandleHover] = useState(false)

  const key = `${structureKey(doc)}#${worldEpoch}`

  // (Re)build the Jolt world whenever the structure changes. Full rebuild is fine
  // for M1 (small scenes); incremental add/remove is a later-milestone optimization.
  useEffect(() => {
    drag.current = null
    pausedDrag.current = null
    store.getState().setDraggingId(null)
    worldRef.current?.dispose()
    worldRef.current = new PhysicsWorld(Jolt, store.getState().doc, (matA, matB, speed) => {
      const s = store.getState()
      if (!s.soundOn || !s.running) return
      playImpact(matA, speed)
      playImpact(matB, speed * 0.8) // usually throttled away; adds body on hard hits
    })
    return () => {
      worldRef.current?.dispose()
      worldRef.current = null
    }
  }, [Jolt, store, key])

  // While paused with the transform tool, direct manipulation owns the selected
  // mesh's transform; the frame loop must not overwrite it.
  const gizmoActive = !running && tool === 'transform' && !!selectedId
  const gizmoMesh = gizmoActive && selectedId ? meshes.current.get(selectedId) : undefined
  const selectedPiece = selectedId ? doc.pieces.find((p) => p.id === selectedId) : undefined

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

  const endPausedDrag = () => {
    const pd = pausedDrag.current
    if (!pd) return
    pausedDrag.current = null
    store.getState().setDraggingId(null)
    const mesh = meshes.current.get(pd.id)
    if (!mesh) return
    store.getState().movePieceTransform(pd.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    })
  }

  // Start a paused-mode drag. Jointed pieces move along their joint's freedom
  // (slide along the axis, swing around it) so the user can align the motion;
  // loose pieces move freely on the ground plane (shift = vertically).
  const beginPausedDrag = (piece: import('../document/types').Piece, e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    const mesh = meshes.current.get(piece.id)
    if (!mesh) return
    const s = store.getState()
    const joint = s.doc.fasteners.find(
      (f) => isJointType(f.type) && (f.partA === piece.id || f.partB === piece.id),
    )
    const base: PausedDrag = {
      id: piece.id,
      mode: 'free',
      offX: e.point.x - mesh.position.x,
      offZ: e.point.z - mesh.position.z,
      centerY: mesh.position.y,
      planeY: e.point.y,
      grabOffY: e.point.y - mesh.position.y,
    }
    if (joint) {
      const pieceA = s.doc.pieces.find((p) => p.id === joint.partA)
      const pieceB = s.doc.pieces.find((p) => p.id === joint.partB)
      if (pieceA && pieceB) {
        const axis = new Vector3(
          ...localDirToWorld(pieceA.state.transform, joint.axisA ?? [0, 1, 0]),
        ).normalize()
        if (joint.type === 'pivot') {
          const anchor = new Vector3(...localToWorld(pieceA.state.transform, joint.anchorA ?? [0, 0, 0]))
          const denom = axis.dot(e.ray.direction)
          if (Math.abs(denom) > 1e-6) {
            const t = axis.dot(anchor.clone().sub(e.ray.origin)) / denom
            const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
            const v0 = hit.sub(anchor).addScaledVector(axis, -hit.clone().sub(anchor).dot(axis))
            if (v0.lengthSq() > 1e-8) {
              pausedDrag.current = {
                ...base,
                mode: 'swing',
                axis,
                anchor,
                startVec: v0.normalize(),
                quat0: mesh.quaternion.clone(),
                center0: mesh.position.clone(),
              }
            }
          }
        } else {
          // linear / cylindrical: slide along the axis within the end stops.
          const anchorAw = new Vector3(...localToWorld(pieceA.state.transform, joint.anchorA ?? [0, 0, 0]))
          const anchorBw = new Vector3(...localToWorld(pieceB.state.transform, joint.anchorB ?? [0, 0, 0]))
          const d0 = axis.dot(anchorAw.clone().sub(anchorBw))
          let minD = -Infinity
          let maxD = Infinity
          if (joint.slideMin != null && joint.slideMax != null) {
            if (piece.id === joint.partA) {
              minD = joint.slideMin - d0
              maxD = joint.slideMax - d0
            } else {
              minD = d0 - joint.slideMax
              maxD = d0 - joint.slideMin
            }
          }
          const startPos = mesh.position.clone()
          pausedDrag.current = {
            ...base,
            mode: 'slide',
            axis,
            startPos,
            startParam: lineParam(startPos, axis, e.ray.origin, e.ray.direction) ?? 0,
            minD,
            maxD,
          }
        }
      }
    }
    if (!pausedDrag.current) pausedDrag.current = base
    s.setDraggingId(piece.id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const movePausedDrag = (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    const pd = pausedDrag.current
    if (!pd) return
    const mesh = meshes.current.get(pd.id)
    if (!mesh) return
    if (pd.mode === 'slide' && pd.axis && pd.startPos) {
      const t = lineParam(pd.startPos, pd.axis, e.ray.origin, e.ray.direction)
      if (t == null) return
      const delta = Math.min(pd.maxD ?? Infinity, Math.max(pd.minD ?? -Infinity, t - (pd.startParam ?? 0)))
      mesh.position.copy(pd.startPos).addScaledVector(pd.axis, delta)
      return
    }
    if (pd.mode === 'swing' && pd.axis && pd.anchor && pd.startVec && pd.quat0 && pd.center0) {
      const denom = pd.axis.dot(e.ray.direction)
      if (Math.abs(denom) < 1e-6) return
      const t = pd.axis.dot(pd.anchor.clone().sub(e.ray.origin)) / denom
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
      const v1 = hit.sub(pd.anchor)
      v1.addScaledVector(pd.axis, -v1.dot(pd.axis))
      if (v1.lengthSq() < 1e-8) return
      v1.normalize()
      const cross = pd.startVec.clone().cross(v1)
      const angle = Math.atan2(cross.dot(pd.axis), pd.startVec.dot(v1))
      const q = new Quaternion().setFromAxisAngle(pd.axis, angle)
      mesh.quaternion.copy(q.clone().multiply(pd.quat0))
      mesh.position.copy(pd.anchor).add(pd.center0.clone().sub(pd.anchor).applyQuaternion(q))
      return
    }
    // free
    if (e.nativeEvent.shiftKey) {
      const lineOrigin = new Vector3(mesh.position.x, 0, mesh.position.z)
      const t = lineParam(lineOrigin, UP, e.ray.origin, e.ray.direction)
      if (t == null) return
      const newY = Math.max(0.01, t - pd.grabOffY)
      mesh.position.y = newY
      pd.centerY = newY
      pd.planeY = newY + pd.grabOffY
    } else {
      if (Math.abs(e.ray.direction.y) < 1e-6) return
      const t = (pd.planeY - e.ray.origin.y) / e.ray.direction.y
      if (t <= 0) return
      mesh.position.x = e.ray.origin.x + e.ray.direction.x * t - pd.offX
      mesh.position.z = e.ray.origin.z + e.ray.direction.z * t - pd.offZ
      mesh.position.y = pd.centerY
    }
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
            if (pausedDrag.current?.id === piece.id) {
              movePausedDrag(e)
              return
            }
            // Dragging (running): slide the piece along the horizontal plane it
            // was grabbed on; shift lifts it vertically instead.
            const d = drag.current
            if (d && d.id === piece.id) {
              if (e.nativeEvent.shiftKey) {
                const lineOrigin = new Vector3(d.target[0], 0, d.target[2])
                const t = lineParam(lineOrigin, UP, e.ray.origin, e.ray.direction)
                if (t != null) {
                  d.centerY = Math.max(0.02, t - d.grabOffY)
                  d.planeY = d.centerY + d.grabOffY
                  d.target = [d.target[0], d.centerY, d.target[2]]
                }
              } else if (e.ray.direction.y !== 0) {
                const t = (d.planeY - e.ray.origin.y) / e.ray.direction.y
                if (t > 0) {
                  const hx = e.ray.origin.x + e.ray.direction.x * t
                  const hz = e.ray.origin.z + e.ray.direction.z * t
                  d.target = [hx - d.offX, d.centerY, hz - d.offZ]
                }
              }
            }
          }}
          onPointerDown={(e) => {
            const s = store.getState()
            // Pointer priority: stock placement > joint picking > fastening (A→B) > drag/select.
            if (s.activeTool) {
              e.stopPropagation()
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
            if (s.tool !== 'transform') return
            if (s.running) {
              // Default tool while the sim runs: drag the piece across the canvas.
              if (!piece.anchored && worldRef.current?.beginGrab(piece.id)) {
                const [cx, cy, cz] = piece.state.transform.position
                drag.current = {
                  id: piece.id,
                  offX: e.point.x - cx,
                  offZ: e.point.z - cz,
                  centerY: cy,
                  planeY: e.point.y,
                  grabOffY: e.point.y - cy,
                  target: [cx, cy, cz],
                }
                s.setDraggingId(piece.id)
                ;(e.target as Element).setPointerCapture(e.pointerId)
              }
            } else {
              // Paused: body-drag moves the piece (joint-constrained when jointed).
              beginPausedDrag(piece, e)
            }
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endDrag()
            }
            if (pausedDrag.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endPausedDrag()
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
      {/* Paused + transform tool: rotate rings (always on) + resize handles. */}
      {gizmoMesh && (
        <TransformControls object={gizmoMesh} mode="rotate" enabled={!handleHover} onMouseUp={() => {
          const s = store.getState()
          const id = s.selectedId
          const mesh = id ? meshes.current.get(id) : undefined
          if (!id || !mesh) return
          s.movePieceTransform(id, {
            position: [mesh.position.x, mesh.position.y, mesh.position.z],
            rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
          })
        }} />
      )}
      {gizmoMesh && selectedPiece && (
        <ResizeHandles piece={selectedPiece} mesh={gizmoMesh} onHoverChange={setHandleHover} />
      )}
      <JointEditor />
    </>
  )
}

/** The workbench slab: a visible platform where the action happens. */
function Sandbox() {
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  if (!sandbox) return null
  return (
    <mesh position={[0, sandbox.thickness / 2, 0]} receiveShadow>
      <boxGeometry args={[sandbox.size, sandbox.thickness, sandbox.size]} />
      <meshStandardMaterial color="#e9eef4" roughness={0.9} metalness={0} />
    </mesh>
  )
}

/** Frame all pieces when the toolbar's fit button fires. */
function FitListener() {
  const store = useStoreApi()
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  useEffect(() => {
    const onFit = () => {
      const doc = store.getState().doc
      const center = new Vector3()
      let radius = (doc.ground.sandbox?.size ?? 4) / 2
      if (doc.pieces.length > 0) {
        const min = new Vector3(Infinity, Infinity, Infinity)
        const max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const p of doc.pieces) {
          const pos = new Vector3(...p.state.transform.position)
          const half = maxExtent(p) / 2
          min.min(pos.clone().subScalar(half))
          max.max(pos.clone().addScalar(half))
        }
        center.copy(min).add(max).multiplyScalar(0.5)
        radius = Math.max(0.5, max.clone().sub(min).length() / 2)
      }
      const fov = ((camera as { fov?: number }).fov ?? 45) * (Math.PI / 180)
      const dist = (radius / Math.tan(fov / 2)) * 1.25
      const dir = camera.position
        .clone()
        .sub(controls ? controls.target : new Vector3())
        .normalize()
      if (controls) {
        controls.target.copy(center)
        camera.position.copy(center.clone().addScaledVector(dir, dist))
        controls.update()
      }
    }
    window.addEventListener('neocad:fit', onFit)
    return () => window.removeEventListener('neocad:fit', onFit)
  }, [camera, controls, store])
  return null
}

export function Scene() {
  // Load Jolt once; render the simulation only after the WASM module is ready.
  const joltRef = useRef<JoltModule | null>(null)
  const ready = useJolt(joltRef)
  const store = useStoreApi()
  const draggingId = useDocStore((s) => s.draggingId)
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  const orbitRef = useRef<OrbitControlsImpl | null>(null)

  return (
    <Canvas
      shadows
      camera={{ position: [3.5, 2.6, 4.5], fov: 45 }}
      onPointerMissed={() => {
        store.getState().select(null)
        store.getState().selectFastener(null)
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
      {/* Shadow catcher just under the workbench so shadows read on white. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
      <Sandbox />
      {/* Workplane grid rides on top of the sandbox slab. */}
      <Grid
        position={[0, (sandbox?.thickness ?? 0) + 0.002, 0]}
        args={[sandbox?.size ?? 40, sandbox?.size ?? 40]}
        cellSize={0.1}
        sectionSize={0.5}
        cellColor="#dde3ea"
        sectionColor="#b6c2d0"
        fadeDistance={40}
      />
      <DevCameraHook />
      <FitListener />
      {ready && joltRef.current && <Sim Jolt={joltRef.current} />}
      <HeldPiece />
      {/* Tinkercad-style view cube: click faces/edges to orbit to that view. */}
      <GizmoHelper alignment="top-right" margin={[70, 70]}>
        <GizmoViewcube
          color="#f4f6f9"
          strokeColor="#8494a7"
          textColor="#33465c"
          hoverColor="#dbe6f4"
        />
      </GizmoHelper>
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

// Dev-only hook so e2e scripts can project world→screen through the live camera.
function DevCameraHook() {
  const camera = useThree((s) => s.camera)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__camera = camera
  }
  return null
}

// Small hook: resolve the Jolt module and trigger a re-render when ready.
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
