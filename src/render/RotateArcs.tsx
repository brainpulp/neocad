import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Group, Quaternion, Vector3, type Mesh } from 'three'
import type { Piece } from '../document/types'
import { maxExtent } from './geometry'
import { useStoreApi } from '../ui/storeContext'

/**
 * Tinkercad-style rotation: three short arc handles parked just outside the
 * piece, one per local axis. Dragging an arc spins the piece around that axis
 * (Shift snaps to 15°). Lives alongside the resize handles without overlapping
 * them — everything mounts on the bounding-box shell, nothing orbits the piece.
 */

const AXES: { axis: Vector3; color: string; /** places the arc segment */ phase: number }[] = [
  { axis: new Vector3(1, 0, 0), color: '#e06666', phase: Math.PI / 4 },
  { axis: new Vector3(0, 1, 0), color: '#5aa860', phase: Math.PI / 4 },
  { axis: new Vector3(0, 0, 1), color: '#4a7fd6', phase: Math.PI / 4 },
]
const ARC = 1.0 // radians of visible arc

interface DragState {
  axisWorld: Vector3
  center: Vector3
  startVec: Vector3
  quat0: Quaternion
  angle: number
}

export function RotateArcs({ piece, mesh }: { piece: Piece; mesh: Mesh }) {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  const drag = useRef<DragState | null>(null)
  const [activeAxis, setActiveAxis] = useState<number | null>(null)
  const [angleLabel, setAngleLabel] = useState('')
  const radius = maxExtent(piece) * 0.75 + 0.08

  // Track the piece (position + orientation) so arcs rotate with it.
  useFrame(() => {
    const g = group.current
    if (!g) return
    mesh.updateMatrixWorld()
    g.position.copy(mesh.position)
    g.quaternion.copy(mesh.quaternion)
  })

  const planeHit = (e: ThreeEvent<PointerEvent>, axisWorld: Vector3, center: Vector3) => {
    const denom = axisWorld.dot(e.ray.direction)
    if (Math.abs(denom) < 1e-6) return null
    const t = axisWorld.dot(center.clone().sub(e.ray.origin)) / denom
    if (t <= 0) return null
    const v = e.ray.origin.clone().addScaledVector(e.ray.direction, t).sub(center)
    v.addScaledVector(axisWorld, -v.dot(axisWorld))
    return v.lengthSq() < 1e-8 ? null : v.normalize()
  }

  const startDrag = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    mesh.updateMatrixWorld()
    const axisWorld = AXES[i].axis.clone().applyQuaternion(mesh.quaternion).normalize()
    const center = mesh.position.clone()
    const v0 = planeHit(e, axisWorld, center)
    if (!v0) return
    drag.current = { axisWorld, center, startVec: v0, quat0: mesh.quaternion.clone(), angle: 0 }
    setActiveAxis(i)
    setAngleLabel('0°')
    store.getState().setDraggingId(piece.id) // freeze orbit
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    const v1 = planeHit(e, st.axisWorld, st.center)
    if (!v1) return
    let angle = Math.atan2(st.startVec.clone().cross(v1).dot(st.axisWorld), st.startVec.dot(v1))
    if (e.nativeEvent.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) // 15°
    st.angle = angle
    mesh.quaternion.copy(new Quaternion().setFromAxisAngle(st.axisWorld, angle).multiply(st.quat0))
    setAngleLabel(`${Math.round((angle * 180) / Math.PI)}°`)
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    drag.current = null
    setActiveAxis(null)
    const s = store.getState()
    s.setDraggingId(null)
    s.movePieceTransform(piece.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    })
  }

  return (
    <group ref={group}>
      {AXES.map(({ axis, color, phase }, i) => (
        <group
          key={i}
          // Orient the torus plane ⊥ the axis; slide the visible segment to a corner.
          quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis)}
        >
          <group rotation={[0, 0, phase]}>
            {/* Visible arc */}
            <mesh renderOrder={997} raycast={() => null}>
              <torusGeometry args={[radius, 0.006, 8, 24, ARC]} />
              <meshBasicMaterial
                color={activeAxis === i ? '#ff8a00' : color}
                depthTest={false}
                toneMapped={false}
                transparent
                opacity={activeAxis == null || activeAxis === i ? 0.95 : 0.25}
              />
            </mesh>
            {/* Arrow tips */}
            {[0, ARC].map((a, k) => (
              <mesh
                key={k}
                position={[Math.cos(a) * radius, Math.sin(a) * radius, 0]}
                rotation={[0, 0, a + (k === 0 ? -Math.PI / 2 : Math.PI / 2)]}
                renderOrder={997}
                raycast={() => null}
              >
                <coneGeometry args={[0.018, 0.045, 10]} />
                <meshBasicMaterial
                  color={activeAxis === i ? '#ff8a00' : color}
                  depthTest={false}
                  toneMapped={false}
                />
              </mesh>
            ))}
            {/* Fat invisible picker */}
            <mesh
              renderOrder={996}
              onPointerDown={startDrag(i)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
            >
              <torusGeometry args={[radius, 0.035, 6, 18, ARC]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        </group>
      ))}
      {activeAxis != null && (
        <Html center style={{ pointerEvents: 'none' }} position={[0, radius + 0.1, 0]}>
          <div className="dim-bubble">{angleLabel}</div>
        </Html>
      )}
    </group>
  )
}
