import { useEffect, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { Quaternion, Vector3, type Mesh } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { localDirToWorld, localToWorld } from '../document/math'
import { isJointType, type Piece } from '../document/types'
import { maxExtent } from './geometry'
import { useDocStore, useStoreApi } from '../ui/storeContext'

const SNAP = (15 * Math.PI) / 180

type AxisKey = 'x' | 'y' | 'z'
const AXES: Record<AxisKey, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}
const AXIS_COLOR: Record<AxisKey, string> = { x: '#e05c5c', y: '#4caf50', z: '#3d7bd9' }

interface DragState {
  startVec: Vector3
  quat0: Quaternion
  pos0: Vector3
  angle: number
}

/**
 * The on-demand rotate ring: while the sim is paused with a piece selected,
 * HOLDING ALT shows one ring for the current axis. Dragging along it rotates
 * in 15° steps (Shift = free). X / Y / Z switch the axis while the ring shows.
 *
 * Jointed pieces respect their joint: the ring aligns to the JOINT axis and
 * swings the piece around the joint anchor — pieces whose joints allow no
 * rotation show no ring at all.
 */
export function RotateRing({ piece, mesh }: { piece: Piece; mesh: Mesh }) {
  const store = useStoreApi()
  const pieces = useDocStore((s) => s.doc.pieces)
  const joint = useDocStore((s) =>
    s.doc.fasteners.find(
      (f) => isJointType(f.type) && (f.partA === piece.id || f.partB === piece.id),
    ),
  )
  const [altDown, setAltDown] = useState(false)
  const [axisKey, setAxisKey] = useState<AxisKey>('y')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hover, setHover] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  // The ring shows while Alt is held (or a drag is in flight). X/Y/Z retarget it.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(true)
      if (['x', 'y', 'z'].includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey) {
        setAxisKey(e.key.toLowerCase() as AxisKey)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false)
    }
    const blur = () => setAltDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  if (!altDown && !drag) return null

  // Joint-aware axis + pivot: pivots/cylindricals(spin) rotate about the JOINT.
  let axis: Vector3
  let pivot: Vector3
  let jointConstrained = false
  if (joint) {
    const canSpin =
      joint.type === 'pivot' || (joint.type === 'cylindrical' && (joint.canSpin ?? true))
    if (!canSpin) return null // this joint allows no rotation — no ring
    const pieceA = pieces.find((p) => p.id === joint.partA)
    if (!pieceA) return null
    axis = new Vector3(...localDirToWorld(pieceA.state.transform, joint.axisA ?? [0, 1, 0])).normalize()
    pivot = new Vector3(...localToWorld(pieceA.state.transform, joint.anchorA ?? [0, 0, 0]))
    jointConstrained = true
  } else {
    axis = AXES[axisKey]
    pivot = mesh.position.clone()
  }

  const radius = Math.max(0.12, (maxExtent(piece) / 2) * 1.35)
  const color = jointConstrained ? '#e8a13a' : AXIS_COLOR[axisKey]

  // Pointer ray ∩ the ring's plane → vector from the pivot, for angle math.
  const planeHit = (e: ThreeEvent<PointerEvent>): Vector3 | null => {
    const denom = axis.dot(e.ray.direction)
    if (Math.abs(denom) < 1e-6) return null
    const t = axis.dot(pivot.clone().sub(e.ray.origin)) / denom
    if (t <= 0) return null
    const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
    const v = hit.sub(pivot)
    v.addScaledVector(axis, -v.dot(axis))
    return v.lengthSq() < 1e-8 ? null : v.normalize()
  }

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const v0 = planeHit(e)
    if (!v0) return
    const st: DragState = {
      startVec: v0,
      quat0: mesh.quaternion.clone(),
      pos0: mesh.position.clone(),
      angle: 0,
    }
    dragRef.current = st
    setDrag(st)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const st = dragRef.current
    if (!st) return
    e.stopPropagation()
    const v1 = planeHit(e)
    if (!v1) return
    const cross = st.startVec.clone().cross(v1)
    let angle = Math.atan2(cross.dot(axis), st.startVec.dot(v1))
    // 15° steps read as intentional carpentry; Shift = freehand.
    if (!e.nativeEvent.shiftKey) angle = Math.round(angle / SNAP) * SNAP
    const q = new Quaternion().setFromAxisAngle(axis, angle)
    mesh.quaternion.copy(q.clone().multiply(st.quat0))
    // Jointed pieces swing AROUND the joint anchor, not their own center.
    if (jointConstrained) {
      mesh.position.copy(pivot).add(st.pos0.clone().sub(pivot).applyQuaternion(q))
    }
    dragRef.current = { ...st, angle }
    setDrag(dragRef.current)
  }

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const st = dragRef.current
    if (!st) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDrag(null)
    store.getState().movePieceTransform(piece.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    })
  }

  // Orient the torus (its hole axis is +Z by default → rotate Z onto the axis).
  const ringQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis)

  return (
    <group position={pivot} quaternion={ringQuat}>
      {/* visible ring */}
      <mesh raycast={() => null}>
        <torusGeometry args={[radius, 0.004, 10, 96]} />
        <meshBasicMaterial color={color} transparent opacity={drag || hover ? 1 : 0.75} depthTest={false} />
      </mesh>
      {/* fat invisible grab tube */}
      <mesh
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <torusGeometry args={[radius, 0.03, 8, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {drag && (
        <Html center style={{ pointerEvents: 'none' }} position={[0, 0, 0]}>
          <div className="dim-bubble">{Math.round((drag.angle * 180) / Math.PI)}°</div>
        </Html>
      )}
      {!drag && !jointConstrained && (
        <Html center style={{ pointerEvents: 'none' }} position={[radius * 1.15, 0, 0]}>
          <div className="dim-bubble" style={{ opacity: 0.85 }}>
            {axisKey.toUpperCase()} · press X/Y/Z
          </div>
        </Html>
      )}
    </group>
  )
}
