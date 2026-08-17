import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, Quaternion, Vector3, type Group, type Mesh } from 'three'
import type { Document, Fastener, Vec3 } from '../document/types'
import { localDirToWorld, localToWorld } from '../document/math'
import { useDocStore, useStoreApi } from '../ui/storeContext'

const UP_TMP = new Vector3(0, 1, 0)
const DIR_TMP = new Vector3()
const QUAT_TMP = new Quaternion()

// Joint-family color language: orange = rigid bond, blue = motion joint,
// green = elastic. Selection turns any glyph hot orange.
const RIGID_COLOR = '#e8a13a'
const MOTION_COLOR = '#2f6df0'
const SPRING_COLOR = '#5a8f3c'
const SELECTED_COLOR = '#ff8a00'

/**
 * Where to draw a fastener's marker: a joint's stored anchor (tracked on part A),
 * else the midpoint between the two pieces. Null if a piece is missing.
 */
export function fastenerMidpoint(doc: Document, fastener: Fastener): Vec3 | null {
  const a = doc.pieces.find((p) => p.id === fastener.partA)
  const b = doc.pieces.find((p) => p.id === fastener.partB)
  if (!a || !b) return null
  if (fastener.anchorA) return localToWorld(a.state.transform, fastener.anchorA)
  const pa = a.state.transform.position
  const pb = b.state.transform.position
  return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]
}

/**
 * Each fastener type gets a FLAT 2D symbol placed in a 3D plane — a schematic
 * badge, not a chunky 3D prop. Motion symbols lie in the plane of the joint
 * axis (hinge arc, slider double-arrow, axle rings); rigid symbols billboard to
 * face the camera. Screen-scaled, x-ray so they never hide inside geometry, and
 * the click target that opens the joint inspector.
 */
export function FastenerMarker({ fastener }: { fastener: Fastener }) {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  const coil = useRef<Mesh>(null)
  const selected = useDocStore((s) => s.selectedFastenerId === fastener.id)

  const isMotion =
    fastener.type === 'pivot' || fastener.type === 'linear' || fastener.type === 'cylindrical'

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const doc = store.getState().doc
    const mid = fastenerMidpoint(doc, fastener)
    if (!mid) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.set(mid[0], mid[1], mid[2])
    const a = doc.pieces.find((p) => p.id === fastener.partA)
    if (isMotion && a) {
      // Motion symbol lies in the plane spanned by the joint axis: put +Y on the
      // axis (arc/arrow/ring geometry is authored around +Y).
      const axis = localDirToWorld(a.state.transform, fastener.axisA ?? [0, 1, 0])
      DIR_TMP.set(axis[0], axis[1], axis[2]).normalize()
      g.quaternion.copy(QUAT_TMP.setFromUnitVectors(UP_TMP, DIR_TMP))
    } else {
      // Rigid/spring badges billboard toward the camera (flat, always readable).
      g.quaternion.copy(camera.quaternion)
    }
    const s = Math.min(2.2, Math.max(0.55, camera.position.distanceTo(g.position) / 3.5))
    g.scale.setScalar(s)

    if (fastener.type === 'spring' && coil.current) {
      const pa = a ? localToWorld(a.state.transform, fastener.anchorA ?? [0, 0, 0]) : mid
      const b = doc.pieces.find((p) => p.id === fastener.partB)
      const pb = b ? localToWorld(b.state.transform, fastener.anchorB ?? [0, 0, 0]) : mid
      const dx = pb[0] - pa[0]
      const dy = pb[1] - pa[1]
      const dz = pb[2] - pa[2]
      const len = Math.hypot(dx, dy, dz)
      coil.current.visible = len > 1e-4
      coil.current.position.set((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2)
      coil.current.scale.set(1, Math.max(0.01, len), 1)
      coil.current.quaternion.setFromUnitVectors(UP_TMP, DIR_TMP.set(dx / len, dy / len, dz / len))
    }
  })

  const color = selected
    ? SELECTED_COLOR
    : fastener.type === 'spring'
      ? SPRING_COLOR
      : isMotion
        ? MOTION_COLOR
        : RIGID_COLOR

  // Flat symbol material: unlit, x-ray (draws over geometry — joints sit at the
  // mating interface and would otherwise be buried), double-sided.
  const flat = (opacity = 1) => (
    <meshBasicMaterial
      color={color}
      side={DoubleSide}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
    />
  )

  // Hinge arc sweep mirrors the actual swing limits (default: 3/4 turn).
  const sweep =
    fastener.angleMin != null && fastener.angleMax != null
      ? Math.min(Math.PI * 2, Math.max(0.4, fastener.angleMax - fastener.angleMin))
      : Math.PI * 1.5

  return (
    <>
      {fastener.type === 'spring' && (
        <mesh ref={coil} raycast={() => null}>
          <cylinderGeometry args={[0.012, 0.012, 1, 8, 1, true]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}
      <group
        ref={group}
        renderOrder={10}
        onPointerDown={(e) => {
          e.stopPropagation()
          store.getState().selectFastener(fastener.id)
        }}
      >
        {fastener.type === 'pivot' && (
          <>
            {/* flat swing arc in the plane ⊥ the pin, + the axis line */}
            <mesh rotation={[Math.PI / 2, 0, 0]} key={`arc:${sweep.toFixed(2)}`}>
              <ringGeometry args={[0.075, 0.092, 40, 1, 0, sweep]} />
              {flat()}
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0, 0.09, 3, 1, 0, sweep]} />
              {flat(0.18)}
            </mesh>
            {/* the pin, as a thin flat bar along the axis */}
            <mesh>
              <planeGeometry args={[0.01, 0.19]} />
              {flat()}
            </mesh>
          </>
        )}
        {fastener.type === 'linear' && (
          <>
            {/* double-headed travel arrow (flat) with end-stop ticks */}
            <mesh>
              <planeGeometry args={[0.012, 0.17]} />
              {flat()}
            </mesh>
            <mesh position={[0, 0.11, 0]}>
              <circleGeometry args={[0.028, 3]} />
              {flat()}
            </mesh>
            <mesh position={[0, -0.11, 0]} rotation={[0, 0, Math.PI]}>
              <circleGeometry args={[0.028, 3]} />
              {flat()}
            </mesh>
            <mesh position={[0, 0.14, 0]}>
              <planeGeometry args={[0.07, 0.012]} />
              {flat()}
            </mesh>
            <mesh position={[0, -0.14, 0]}>
              <planeGeometry args={[0.07, 0.012]} />
              {flat()}
            </mesh>
          </>
        )}
        {fastener.type === 'cylindrical' && (
          <>
            {/* two flat rings around the shaft axis + a slide arrow = spin & slide */}
            <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.05, 0.062, 32]} />
              {flat()}
            </mesh>
            <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.05, 0.062, 32]} />
              {flat()}
            </mesh>
            <mesh>
              <planeGeometry args={[0.01, 0.13]} />
              {flat()}
            </mesh>
          </>
        )}
        {fastener.type === 'weld' && (
          <mesh>
            {/* filled disc with a ring = a bead */}
            <circleGeometry args={[0.05, 24]} />
            {flat(0.9)}
          </mesh>
        )}
        {fastener.type === 'bolt' && (
          <mesh>
            {/* flat hex */}
            <circleGeometry args={[0.05, 6]} />
            {flat()}
          </mesh>
        )}
        {fastener.type === 'nail' && (
          <>
            <mesh position={[0, 0.03, 0]}>
              <circleGeometry args={[0.028, 16]} />
              {flat()}
            </mesh>
            <mesh position={[0, -0.04, 0]}>
              <planeGeometry args={[0.014, 0.09]} />
              {flat()}
            </mesh>
          </>
        )}
        {fastener.type === 'glue' && (
          <mesh scale={[1, 1.15, 1]}>
            {/* teardrop-ish: a disc squished vertically */}
            <circleGeometry args={[0.042, 20]} />
            {flat(0.85)}
          </mesh>
        )}
        {fastener.type === 'spring' && (
          <mesh>
            <circleGeometry args={[0.03, 16]} />
            {flat()}
          </mesh>
        )}
      </group>
    </>
  )
}
