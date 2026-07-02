import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Group, Quaternion, Vector3, type Mesh } from 'three'
import { STOCK } from '../document/catalog'
import type { Piece } from '../document/types'
import { useStoreApi } from '../ui/storeContext'

interface HandleDef {
  id: string
  kind: 'corner' | 'top' | 'lift'
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
        { id: 'lift', kind: 'lift', local: [0, y, 0] },
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
        { id: 'lift', kind: 'lift', local: [0, h, 0] },
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
        { id: 'lift', kind: 'lift', local: [0, r, 0] },
      ]
    }
  }
}

interface DragState {
  def: HandleDef
  quat0: Quaternion
  invQuat0: Quaternion
  upWorld: Vector3
  /** World position of the anchor that must NOT move: the opposite base corner
   *  (corner drags) or the bottom of the piece (top drags). */
  anchor: Vector3
  /** Local vector from the anchor to the piece center at scale 1 (y part). */
  anchorToCenterY: number
  /** Horizontal plane height for corner drags. */
  planeY: number
  signX: number
  signZ: number
  /** Lift drags: piece position + line param at grab time. */
  startPos: Vector3
  startParam: number
}

/** Param along a line (origin, unit dir) closest to a pointer ray. */
function lineParam(origin: Vector3, dir: Vector3, rayOrigin: Vector3, rayDir: Vector3): number | null {
  const b = dir.dot(rayDir)
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-6) return null
  const w = origin.clone().sub(rayOrigin)
  return (b * rayDir.dot(w) - dir.dot(w)) / denom
}

const MIN_SCALE = 0.05
const cm = (v: number) => `${(v * 100).toFixed(2)}`
const UP_V = new Vector3(0, 1, 0)

/** Position a dimension-line rig: main line between two world points + end ticks. */
function setLineRig(g: Group | null, a: Vector3, b: Vector3, tickDir: Vector3): void {
  if (!g) return
  const dir = b.clone().sub(a)
  const len = dir.length()
  if (len < 1e-5) {
    g.visible = false
    return
  }
  g.visible = true
  dir.normalize()
  const [main, tickA, tickB] = g.children
  main.position.copy(a).addScaledVector(dir, len / 2)
  main.quaternion.setFromUnitVectors(UP_V, dir)
  main.scale.set(0.0025, len, 0.0025)
  for (const [tick, p] of [
    [tickA, a],
    [tickB, b],
  ] as const) {
    tick.position.copy(p)
    tick.quaternion.setFromUnitVectors(UP_V, tickDir)
    tick.scale.set(0.0025, 0.045, 0.0025)
  }
}

/** Three thin cylinders: the dimension line and its two end ticks. */
function LineRig({ groupRef }: { groupRef: React.RefObject<Group> }) {
  return (
    <group ref={groupRef} visible={false}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} renderOrder={998} raycast={() => null}>
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <meshBasicMaterial color="#33465c" depthTest={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export function ResizeHandles({ piece, mesh, onHoverChange }: Props) {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  const drag = useRef<DragState | null>(null)
  const [dragKind, setDragKind] = useState<'corner' | 'top' | 'lift' | null>(null)
  const labelX = useRef<HTMLDivElement>(null)
  const labelZ = useRef<HTMLDivElement>(null)
  const labelY = useRef<HTMLDivElement>(null)
  const labelGroupX = useRef<Group>(null)
  const labelGroupZ = useRef<Group>(null)
  const labelGroupY = useRef<Group>(null)
  const lineX = useRef<Group>(null)
  const lineZ = useRef<Group>(null)
  const lineY = useRef<Group>(null)
  const defs = handleDefs(piece)
  const prim = STOCK[piece.stockType].primitive
  const d = piece.dimensions
  const fullHeight = prim === 'box' ? d.y : prim === 'cylinder' ? d.height : d.radius * 2

  // Glue handles to the (possibly scaling) mesh, keep them screen-sized
  // billboards, and track the live dimension bubbles while dragging.
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    mesh.updateMatrixWorld()
    g.children.forEach((child, i) => {
      const def = defs[i]
      if (!def) return
      child.position.set(...def.local).applyMatrix4(mesh.matrixWorld)
      const dist = camera.position.distanceTo(child.position)
      child.scale.setScalar(Math.max(0.01, dist * 0.008))
      if (def.kind === 'lift') {
        // The lift cone floats above the top handle, oriented with the piece.
        const up = new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion)
        child.position.addScaledVector(up, 0.06 + dist * 0.02)
        child.quaternion.copy(mesh.quaternion)
      } else {
        child.quaternion.copy(camera.quaternion)
      }
    })
    const st = drag.current
    if (!st) {
      for (const rig of [lineX.current, lineZ.current, lineY.current]) if (rig) rig.visible = false
      return
    }
    // Live Tinkercad-style dimension readout: extension lines with end ticks
    // along each measured edge, number chip riding the line (values in cm).
    const sx = mesh.scale.x
    const sy = mesh.scale.y
    const sz = mesh.scale.z
    const l2w = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld)
    const halfX = prim === 'box' ? d.x / 2 : d.radius
    const halfZ = prim === 'box' ? d.z / 2 : d.radius
    const baseY = st.def.kind === 'top' ? -fullHeight / 2 : st.def.local[1]
    if (st.def.kind === 'corner') {
      if (labelX.current)
        labelX.current.textContent = prim === 'box' ? cm(d.x * sx) : cm(d.radius * sx)
      if (labelZ.current) labelZ.current.textContent = cm(prim === 'box' ? d.z * sz : d.radius * 2 * sz)
      // Keep the line a constant world-distance off the edge despite live scale.
      const offZ = st.signZ * (halfZ + 0.05 / Math.max(0.2, sz))
      const offX = st.signX * (halfX + 0.05 / Math.max(0.2, sx))
      const ax = l2w(-halfX, baseY, offZ)
      const bx = l2w(halfX, baseY, offZ)
      const tickZ = l2w(0, baseY, offZ + st.signZ).sub(l2w(0, baseY, offZ)).normalize()
      setLineRig(lineX.current, ax, bx, tickZ)
      labelGroupX.current?.position.copy(ax.clone().add(bx).multiplyScalar(0.5))
      const az = l2w(offX, baseY, -halfZ)
      const bz = l2w(offX, baseY, halfZ)
      const tickX = l2w(offX + st.signX, baseY, 0).sub(l2w(offX, baseY, 0)).normalize()
      setLineRig(lineZ.current, az, bz, tickX)
      labelGroupZ.current?.position.copy(az.clone().add(bz).multiplyScalar(0.5))
    } else if (st.def.kind === 'top') {
      if (labelY.current) labelY.current.textContent = cm(fullHeight * sy)
      const offX = halfX + 0.05 / Math.max(0.2, sx)
      const ay = l2w(offX, -fullHeight / 2, halfZ)
      const by = l2w(offX, fullHeight / 2, halfZ)
      const tick = l2w(offX + 1, -fullHeight / 2, halfZ).sub(ay).normalize()
      setLineRig(lineY.current, ay, by, tick)
      labelGroupY.current?.position.copy(ay.clone().add(by).multiplyScalar(0.5))
    }
  })

  const startDrag = (def: HandleDef) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    mesh.updateMatrixWorld()
    const quat0 = mesh.quaternion.clone()
    const upWorld = new Vector3(0, 1, 0).applyQuaternion(quat0)
    const center0 = mesh.position.clone()
    const startParam = lineParam(center0, upWorld, e.ray.origin, e.ray.direction) ?? 0
    // The anchor that stays put: opposite base corner for corner drags
    // (Tinkercad grows toward the grabbed side), piece bottom for top drags.
    const anchor =
      def.kind === 'corner'
        ? center0
            .clone()
            .add(new Vector3(-def.local[0], def.local[1], -def.local[2]).applyQuaternion(quat0))
        : center0.clone().addScaledVector(upWorld, (-fullHeight / 2) * mesh.scale.y)
    drag.current = {
      def,
      quat0,
      invQuat0: quat0.clone().invert(),
      upWorld,
      anchor,
      anchorToCenterY: -def.local[1],
      planeY: e.point.y,
      signX: Math.sign(def.local[0]) || 1,
      signZ: Math.sign(def.local[2]) || 1,
      startPos: center0,
      startParam,
    }
    setDragKind(def.kind)
    if (def.kind !== 'lift') store.getState().beginTransient() // lift commits via movePieceTransform
    store.getState().setDraggingId(piece.id) // freezes orbit while resizing
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    if (st.def.kind === 'lift') {
      // Raise/lower the whole piece along its up axis (no resize).
      const t = lineParam(st.startPos, st.upWorld, e.ray.origin, e.ray.direction)
      if (t == null) return
      mesh.position.copy(st.startPos).addScaledVector(st.upWorld, t - st.startParam)
      return
    }
    if (st.def.kind === 'corner') {
      // Slide along the horizontal plane the handle started on; the OPPOSITE
      // base corner stays fixed and the piece grows toward the pointer.
      if (Math.abs(e.ray.direction.y) < 1e-6) return
      const t = (st.planeY - e.ray.origin.y) / e.ray.direction.y
      if (t <= 0) return
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
      // Pointer relative to the fixed corner, in the piece's unrotated frame.
      const v = hit.sub(st.anchor).applyQuaternion(st.invQuat0)
      if (prim === 'box') {
        const newX = Math.max(d.x * MIN_SCALE, Math.abs(v.x))
        const newZ = Math.max(d.z * MIN_SCALE, Math.abs(v.z))
        mesh.scale.set(newX / d.x, mesh.scale.y, newZ / d.z)
        // Recenter so the anchor corner is exactly where it was.
        const centerFromAnchor = new Vector3(
          (st.signX * newX) / 2,
          st.anchorToCenterY,
          (st.signZ * newZ) / 2,
        ).applyQuaternion(st.quat0)
        mesh.position.copy(st.anchor).add(centerFromAnchor)
      } else {
        // Round stock scales its radius uniformly; the opposite bounding-box
        // corner of the base stays fixed.
        const s = Math.max(MIN_SCALE, Math.max(Math.abs(v.x), Math.abs(v.z)) / (d.radius * 2))
        if (prim === 'sphere') mesh.scale.setScalar(s)
        else mesh.scale.set(s, mesh.scale.y, s)
        const yFromAnchor = prim === 'sphere' ? d.radius * s : st.anchorToCenterY * mesh.scale.y
        const centerFromAnchor = new Vector3(
          st.signX * d.radius * s,
          yFromAnchor,
          st.signZ * d.radius * s,
        ).applyQuaternion(st.quat0)
        mesh.position.copy(st.anchor).add(centerFromAnchor)
      }
    } else {
      // Top handle: closest point on the piece's up-line to the pointer ray.
      const w = st.anchor.clone().sub(e.ray.origin)
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
      mesh.position.copy(st.anchor).addScaledVector(st.upWorld, newH / 2)
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const st = drag.current
    if (!st) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    drag.current = null
    setDragKind(null)
    const s = store.getState()
    if (st.def.kind === 'lift') {
      // Position-only commit (one undo entry, world rebuild included).
      s.movePieceTransform(piece.id, {
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
      })
      s.setDraggingId(null)
      onHoverChange?.(false)
      return
    }
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
    <>
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
            {def.kind === 'lift' ? (
              <coneGeometry args={[0.45, 1.1, 12]} />
            ) : (
              <planeGeometry args={[1, 1]} />
            )}
            <meshBasicMaterial
              color={def.kind === 'lift' ? '#33465c' : '#ffffff'}
              depthTest={false}
              toneMapped={false}
            />
            {def.kind !== 'lift' && (
              <mesh renderOrder={999} scale={1.25} raycast={() => null}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial color="#5b6673" depthTest={false} toneMapped={false} />
              </mesh>
            )}
          </mesh>
        ))}
      </group>
      {/* Live dimension readouts: extension lines + cm chips, only while dragging. */}
      <LineRig groupRef={lineX} />
      <LineRig groupRef={lineZ} />
      <LineRig groupRef={lineY} />
      {dragKind === 'corner' && (
        <>
          <group ref={labelGroupX}>
            <Html center style={{ pointerEvents: 'none' }}>
              <div className="dim-bubble" ref={labelX} />
            </Html>
          </group>
          <group ref={labelGroupZ}>
            <Html center style={{ pointerEvents: 'none' }}>
              <div className="dim-bubble" ref={labelZ} />
            </Html>
          </group>
        </>
      )}
      {dragKind === 'top' && (
        <group ref={labelGroupY}>
          <Html center style={{ pointerEvents: 'none' }}>
            <div className="dim-bubble" ref={labelY} />
          </Html>
        </group>
      )}
    </>
  )
}

interface Props {
  piece: Piece
  mesh: Mesh
  /** Reports pointer-over/drag so the parent can mute the transform gizmo (it
   *  listens on the whole canvas and would otherwise steal handle drags). */
  onHoverChange?: (hovering: boolean) => void
}
