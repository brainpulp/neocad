import { useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Group, Quaternion, Vector3, type Mesh } from 'three'
import { STOCK } from '../document/catalog'
import type { Piece } from '../document/types'
import { useStoreApi } from '../ui/storeContext'

interface HandleDef {
  id: string
  kind: 'corner' | 'top'
  /** Piece-local position (pre-scale). */
  local: [number, number, number]
}

/** Tinkercad-style: white squares at the base corners (plan resize) + one on top (height). */
function handleDefs(piece: Piece): HandleDef[] {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box': {
      const x = d.x / 2
      const y = d.y / 2
      const z = d.z / 2
      return [
        { id: 'c++', kind: 'corner', local: [x, -y, z] },
        { id: 'c+-', kind: 'corner', local: [x, -y, -z] },
        { id: 'c-+', kind: 'corner', local: [-x, -y, z] },
        { id: 'c--', kind: 'corner', local: [-x, -y, -z] },
        { id: 'top', kind: 'top', local: [0, y, 0] },
      ]
    }
    case 'cylinder': {
      const r = d.radius
      const h = d.height / 2
      return [
        { id: 'c++', kind: 'corner', local: [r, -h, r] },
        { id: 'c+-', kind: 'corner', local: [r, -h, -r] },
        { id: 'c-+', kind: 'corner', local: [-r, -h, r] },
        { id: 'c--', kind: 'corner', local: [-r, -h, -r] },
        { id: 'top', kind: 'top', local: [0, h, 0] },
      ]
    }
    case 'sphere': {
      const r = d.radius
      return [
        { id: 'c++', kind: 'corner', local: [r, -r, r] },
        { id: 'c+-', kind: 'corner', local: [r, -r, -r] },
        { id: 'c-+', kind: 'corner', local: [-r, -r, r] },
        { id: 'c--', kind: 'corner', local: [-r, -r, -r] },
        { id: 'top', kind: 'top', local: [0, r, 0] },
      ]
    }
  }
}

interface DragState {
  def: HandleDef
  center0: Vector3
  quat0: Quaternion
  invQuat0: Quaternion
  upWorld: Vector3
  /** World point at the bottom of the piece (fixed while dragging the top handle). */
  base: Vector3
  /** Horizontal plane height for corner drags. */
  planeY: number
}

const MIN_SCALE = 0.05

interface Props {
  piece: Piece
  mesh: Mesh
  /** Reports pointer-over/drag so the parent can mute the transform gizmo (it
   *  listens on the whole canvas and would otherwise steal handle drags). */
  onHoverChange?: (hovering: boolean) => void
}

export function ResizeHandles({ piece, mesh, onHoverChange }: Props) {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  const drag = useRef<DragState | null>(null)
  const defs = handleDefs(piece)
  const prim = STOCK[piece.stockType].primitive
  const d = piece.dimensions
  const fullHeight = prim === 'box' ? d.y : prim === 'cylinder' ? d.height : d.radius * 2

  // Glue handles to the (possibly scaling) mesh and keep them screen-sized billboards.
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    mesh.updateMatrixWorld()
    g.children.forEach((child, i) => {
      const def = defs[i]
      if (!def) return
      child.position.set(...def.local).applyMatrix4(mesh.matrixWorld)
      const dist = camera.position.distanceTo(child.position)
      child.scale.setScalar(Math.max(0.02, dist * 0.016))
      child.quaternion.copy(camera.quaternion)
    })
  })

  const startDrag = (def: HandleDef) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    mesh.updateMatrixWorld()
    const quat0 = mesh.quaternion.clone()
    const upWorld = new Vector3(0, 1, 0).applyQuaternion(quat0)
    const center0 = mesh.position.clone()
    const base = center0.clone().addScaledVector(upWorld, (-fullHeight / 2) * mesh.scale.y)
    drag.current = {
      def,
      center0,
      quat0,
      invQuat0: quat0.clone().invert(),
      upWorld,
      base,
      planeY: e.point.y,
    }
    store.getState().beginTransient()
    store.getState().setDraggingId(piece.id) // freezes orbit while resizing
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    if (st.def.kind === 'corner') {
      // Slide along the horizontal plane the handle started on.
      if (Math.abs(e.ray.direction.y) < 1e-6) return
      const t = (st.planeY - e.ray.origin.y) / e.ray.direction.y
      if (t <= 0) return
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
      const local = hit.sub(st.center0).applyQuaternion(st.invQuat0)
      if (prim === 'box') {
        const sx = Math.max(MIN_SCALE, Math.abs(local.x) / (d.x / 2))
        const sz = Math.max(MIN_SCALE, Math.abs(local.z) / (d.z / 2))
        mesh.scale.set(sx, mesh.scale.y, sz)
      } else if (prim === 'cylinder') {
        const s = Math.max(MIN_SCALE, Math.hypot(local.x, local.z) / (d.radius * Math.SQRT2))
        mesh.scale.set(s, mesh.scale.y, s)
      } else {
        // Sphere grows uniformly; keep its base on the ground it started on.
        const s = Math.max(MIN_SCALE, Math.hypot(local.x, local.z) / (d.radius * Math.SQRT2))
        mesh.scale.setScalar(s)
        mesh.position.copy(st.base).addScaledVector(st.upWorld, d.radius * s)
      }
    } else {
      // Top handle: closest point on the piece's up-line to the pointer ray.
      const w = st.base.clone().sub(e.ray.origin)
      const d1 = st.upWorld
      const d2 = e.ray.direction
      const b = d1.dot(d2)
      const denom = 1 - b * b
      if (Math.abs(denom) < 1e-6) return
      const dd = d1.dot(w)
      const ee = d2.dot(w)
      const newH = Math.max(fullHeight * MIN_SCALE, (b * ee - dd) / denom)
      const sy = newH / fullHeight
      if (prim === 'sphere') {
        mesh.scale.setScalar(Math.max(MIN_SCALE, sy))
      } else {
        mesh.scale.setY(sy)
      }
      // Grow upward from the fixed base, Tinkercad-style.
      mesh.position.copy(st.base).addScaledVector(st.upWorld, newH / 2)
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    drag.current = null
    const s = store.getState()
    // Fold the live scale back into real stock dimensions (one undo entry).
    const dims = { ...piece.dimensions }
    switch (prim) {
      case 'box':
        dims.x *= mesh.scale.x
        dims.y *= mesh.scale.y
        dims.z *= mesh.scale.z
        break
      case 'cylinder':
        dims.radius *= mesh.scale.x
        dims.height *= mesh.scale.y
        break
      case 'sphere':
        dims.radius *= mesh.scale.x
        break
    }
    mesh.scale.set(1, 1, 1)
    const transform = {
      position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w] as [
        number, number, number, number,
      ],
    }
    s.updatePieceTransient(piece.id, {
      dimensions: dims,
      definition: { transform: structuredClone(transform) },
      state: { transform: structuredClone(transform) },
    })
    s.endTransient()
    s.setDraggingId(null)
    onHoverChange?.(false)
  }

  return (
    <group ref={group}>
      {defs.map((def) => (
        <mesh
          key={def.id}
          renderOrder={1000}
          onPointerDown={startDrag(def)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerOver={() => onHoverChange?.(true)}
          onPointerOut={() => {
            if (!drag.current) onHoverChange?.(false)
          }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} toneMapped={false} />
          <mesh renderOrder={999} scale={1.25} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="#5b6673" depthTest={false} toneMapped={false} />
          </mesh>
        </mesh>
      ))}
    </group>
  )
}
