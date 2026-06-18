import { useRef } from 'react'
import * as THREE from 'three'
import { PivotControls } from '@react-three/drei'
import { transformPatch } from './transform'
import { useStoreApi } from '../ui/storeContext'
import type { Piece } from '../document/types'

/**
 * Tinkercad-style move/rotate/scale gizmo on the selected piece. A parent group places
 * the gizmo at the piece's pose; grabbing a handle auto-pauses physics; dragging writes
 * the live world pose into the piece's State (so Sim moves the real mesh); releasing
 * commits to the Definition (one undo entry) and resumes. Mounted with a key that
 * changes on commit, so it re-seeds at the new pose.
 */
export function TransformGizmo({ piece }: { piece: Piece }) {
  const store = useStoreApi()
  const wasRunning = useRef(false)

  const pos = useRef(new THREE.Vector3())
  const quat = useRef(new THREE.Quaternion())
  const scl = useRef(new THREE.Vector3())
  const lastWorld = useRef(new THREE.Matrix4())
  const moved = useRef(false)

  const [px, py, pz] = piece.state.transform.position
  const [qx, qy, qz, qw] = piece.state.transform.rotation

  const onDragStart = () => {
    const s = store.getState()
    wasRunning.current = s.running
    moved.current = false
    s.setRunning(false)
    s.setTransformDragging(piece.id)
  }

  const onDrag = (_l: THREE.Matrix4, _dl: THREE.Matrix4, w: THREE.Matrix4) => {
    moved.current = true
    lastWorld.current.copy(w)
    w.decompose(pos.current, quat.current, scl.current)
    // Write pose live into State so Sim drives the real mesh to follow the gizmo.
    piece.state.transform.position = [pos.current.x, pos.current.y, pos.current.z]
    piece.state.transform.rotation = [quat.current.x, quat.current.y, quat.current.z, quat.current.w]
  }

  const onDragEnd = () => {
    const s = store.getState()
    // Ignore zero-movement "drags" (a click on a handle) — they'd drift dimensions
    // via float error and waste an undo entry.
    if (!moved.current) {
      s.setTransformDragging(null)
      s.setRunning(wasRunning.current)
      return
    }
    lastWorld.current.decompose(pos.current, quat.current, scl.current)
    s.updatePiece(
      piece.id,
      transformPatch(piece, {
        position: [pos.current.x, pos.current.y, pos.current.z],
        quaternion: [quat.current.x, quat.current.y, quat.current.z, quat.current.w],
        scale: [scl.current.x, scl.current.y, scl.current.z],
      }),
    )
    s.setTransformDragging(null)
    s.setRunning(wasRunning.current)
  }

  return (
    <group position={[px, py, pz]} quaternion={[qx, qy, qz, qw]}>
      <PivotControls
        anchor={[0, 0, 0]}
        depthTest={false}
        lineWidth={2.5}
        fixed
        scale={95}
        annotations
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
      >
        <mesh visible={false}>
          <boxGeometry args={[0.01, 0.01, 0.01]} />
        </mesh>
      </PivotControls>
    </group>
  )
}
