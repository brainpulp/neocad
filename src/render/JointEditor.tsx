import { useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'
import { localDirToWorld, localToWorld } from '../document/math'
import { isJointType, type Vec3 } from '../document/types'
import { useDocStore, useStoreApi } from '../ui/storeContext'

const UP = new Vector3(0, 1, 0)

/** Param along a line (origin, unit dir) closest to a pointer ray. */
function lineParamToRay(origin: Vector3, dir: Vector3, ray: { origin: Vector3; direction: Vector3 }): number | null {
  const b = dir.dot(ray.direction)
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-6) return null
  const w = origin.clone().sub(ray.origin)
  return (b * ray.direction.dot(w) - dir.dot(w)) / denom
}

/**
 * On-screen editor for the selected joint (paused): the axis as a line, two
 * draggable end-stop handles that set the slide limits live, and a draggable
 * tip cone that re-aims the axis (snapping to either piece's principal axes).
 * Everything commits as one undo entry per gesture; the physics world rebuilds
 * on release.
 */
export function JointEditor() {
  const store = useStoreApi()
  const running = useDocStore((s) => s.running)
  const fastenerId = useDocStore((s) => s.selectedFastenerId)
  const doc = useDocStore((s) => s.doc)
  const drag = useRef<null | { kind: 'min' | 'max' | 'axis'; origin: Vector3; axis: Vector3 }>(null)
  const billboards = useRef<(THREE.Object3D | null)[]>([])

  useFrame(({ camera }) => {
    for (const o of billboards.current) {
      if (!o) continue
      o.quaternion.copy(camera.quaternion)
      const dist = camera.position.distanceTo(o.getWorldPosition(new Vector3()))
      o.scale.setScalar(Math.max(0.012, dist * 0.009))
    }
  })

  const f = doc.fasteners.find((x) => x.id === fastenerId)
  if (running || !f || !isJointType(f.type)) return null
  const a = doc.pieces.find((p) => p.id === f.partA)
  const b = doc.pieces.find((p) => p.id === f.partB)
  if (!a || !b) return null

  const anchorW = new Vector3(...localToWorld(a.state.transform, f.anchorA ?? [0, 0, 0]))
  const axisW = new Vector3(...localDirToWorld(a.state.transform, f.axisA ?? [0, 1, 0])).normalize()
  const hasLimits = f.slideMin != null && f.slideMax != null
  const min = f.slideMin ?? -0.3
  const max = f.slideMax ?? 0.3
  const lineLen = hasLimits ? max - min + 0.2 : 0.8
  const lineCenter = anchorW.clone().addScaledVector(axisW, hasLimits ? (min + max) / 2 : 0)
  const lineQuat = new Quaternion().setFromUnitVectors(UP, axisW)
  // Current offset of A's anchor vs B's along the axis — limits may not cross it.
  const anchorBW = new Vector3(...localToWorld(b.state.transform, f.anchorB ?? [0, 0, 0]))
  const d0 = axisW.dot(anchorW.clone().sub(anchorBW))

  const startDrag = (kind: 'min' | 'max' | 'axis') => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    drag.current = { kind, origin: anchorW.clone(), axis: axisW.clone() }
    store.getState().beginTransient()
    store.getState().setDraggingId(f.partA) // freeze orbit
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    const s = store.getState()
    if (st.kind === 'axis') {
      // Re-aim: point the axis at the pointer (plane through the anchor facing
      // the camera), snapping to either piece's principal axes within ~12°.
      const n = e.ray.direction
      const t = n.dot(st.origin.clone().sub(e.ray.origin)) / n.dot(n)
      if (t <= 0) return
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
      let dir = hit.sub(st.origin)
      if (dir.lengthSq() < 1e-8) return
      dir.normalize()
      const cur = s.doc.pieces.find((p) => p.id === f.partA)
      const curB = s.doc.pieces.find((p) => p.id === f.partB)
      const candidates: Vector3[] = []
      for (const piece of [cur, curB]) {
        if (!piece) continue
        for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
          const w = new Vector3(...localDirToWorld(piece.state.transform, ax))
          candidates.push(w, w.clone().negate())
        }
      }
      for (const c of candidates) {
        if (dir.angleTo(c) < 0.21) {
          dir = c
          break
        }
      }
      if (cur) {
        // Store back in A-local space.
        const q = new Quaternion(...cur.state.transform.rotation).invert()
        const local = dir.clone().applyQuaternion(q)
        s.updateFastenerTransient(f.id, { axisA: [local.x, local.y, local.z] })
      }
      return
    }
    // Limit handles slide along the axis; keep min < max and the joint's
    // current position inside the range.
    const t = lineParamToRay(st.origin, st.axis, e.ray)
    if (t == null) return
    if (st.kind === 'min') {
      const v = Math.min(t, Math.min(d0, (f.slideMax ?? 0) - 0.01))
      s.updateFastenerTransient(f.id, { slideMin: v })
    } else {
      const v = Math.max(t, Math.max(d0, (f.slideMin ?? 0) + 0.01))
      s.updateFastenerTransient(f.id, { slideMax: v })
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    drag.current = null
    const s = store.getState()
    s.endTransient()
    s.setDraggingId(null)
    s.bumpWorldEpoch() // rebuild so the constraint adopts the new axis/limits
  }

  let bi = 0
  const billboardRef = (el: THREE.Object3D | null) => {
    billboards.current[bi++] = el
  }

  const handleMesh = (kind: 'min' | 'max', pos: Vector3, label: string) => (
    <group position={pos}>
      <mesh
        ref={billboardRef}
        renderOrder={1001}
        onPointerDown={startDrag(kind)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#1668e3" depthTest={false} toneMapped={false} />
      </mesh>
      <Html center style={{ pointerEvents: 'none' }}>
        <div className="dim-bubble">{label}</div>
      </Html>
    </group>
  )

  return (
    <group>
      {/* Anchor dot */}
      <mesh position={anchorW} renderOrder={999}>
        <sphereGeometry args={[0.012, 12, 8]} />
        <meshBasicMaterial color="#ff8a00" depthTest={false} />
      </mesh>
      {/* Axis line */}
      <mesh position={lineCenter} quaternion={lineQuat} renderOrder={998}>
        <cylinderGeometry args={[0.0035, 0.0035, lineLen, 8]} />
        <meshBasicMaterial color="#1668e3" transparent opacity={0.75} depthTest={false} />
      </mesh>
      {/* Axis re-aim cone at the + tip */}
      <mesh
        position={anchorW.clone().addScaledVector(axisW, (hasLimits ? max : 0.4) + 0.12)}
        quaternion={lineQuat}
        renderOrder={1001}
        onPointerDown={startDrag('axis')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <coneGeometry args={[0.025, 0.06, 12]} />
        <meshBasicMaterial color="#1668e3" depthTest={false} toneMapped={false} />
      </mesh>
      {/* End-stop handles (sliders only) */}
      {hasLimits && (
        <>
          {handleMesh('min', anchorW.clone().addScaledVector(axisW, min), `${(min * 100).toFixed(1)}`)}
          {handleMesh('max', anchorW.clone().addScaledVector(axisW, max), `${(max * 100).toFixed(1)}`)}
        </>
      )}
    </group>
  )
}

// three's Object3D type for refs without importing the whole namespace elsewhere.
import type * as THREE from 'three'
