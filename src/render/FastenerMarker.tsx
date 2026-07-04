import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Quaternion, Vector3, type Group, type Mesh } from 'three'
import type { Document, Fastener, Vec3 } from '../document/types'
import { localDirToWorld, localToWorld } from '../document/math'
import { useDocStore, useStoreApi } from '../ui/storeContext'

const UP_TMP = new Vector3(0, 1, 0)
const DIR_TMP = new Vector3()
const QUAT_TMP = new Quaternion()

// Joint-family color language: orange = rigid bond, blue = motion joint,
// green = elastic. Selection turns any glyph hot orange.
const RIGID_COLOR = '#e8a13a'
const MOTION_COLOR = '#3d7bd9'
const SPRING_COLOR = '#7a9c4e'
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
 * Every fastener type gets its own 3D glyph, so a build reads like a drawing:
 * hinge = swing arc (sweep shows the actual limits), slider = travel arrow with
 * end stops, axle = shaft sleeve, bolt = hex head, nail = pin, weld = bead,
 * glue = droplet, spring = coil tether. Glyphs are screen-scaled, aligned to
 * the live joint axis, and are the click target that opens the joint inspector.
 */
export function FastenerMarker({ fastener }: { fastener: Fastener }) {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  const coil = useRef<Mesh>(null)
  const selected = useDocStore((s) => s.selectedFastenerId === fastener.id)

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
    // Motion glyphs are authored with +Y as the joint axis; align to the live one.
    const a = doc.pieces.find((p) => p.id === fastener.partA)
    if (a && (fastener.type === 'pivot' || fastener.type === 'linear' || fastener.type === 'cylindrical')) {
      const axis = localDirToWorld(a.state.transform, fastener.axisA ?? [0, 1, 0])
      DIR_TMP.set(axis[0], axis[1], axis[2]).normalize()
      g.quaternion.copy(QUAT_TMP.setFromUnitVectors(UP_TMP, DIR_TMP))
    } else {
      g.quaternion.identity()
    }
    // Screen-constant size: ~the same on screen whether zoomed in or out.
    const s = Math.min(2.2, Math.max(0.55, camera.position.distanceTo(g.position) / 3.5))
    g.scale.setScalar(s)

    // Springs also draw their tether between the two live anchor points. The
    // coil mesh is a SIBLING of the scaled glyph group and works in raw world
    // space, exactly like the pre-glyph implementation.
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

  const isMotion =
    fastener.type === 'pivot' || fastener.type === 'linear' || fastener.type === 'cylindrical'
  const color = selected
    ? SELECTED_COLOR
    : fastener.type === 'spring'
      ? SPRING_COLOR
      : isMotion
        ? MOTION_COLOR
        : RIGID_COLOR
  // Rigid-bond badges sit exactly at the mating interface — buried between
  // flush faces they'd be invisible, so they x-ray through geometry. Motion
  // glyphs extend outside the pieces and stay honestly depth-tested.
  const xray = !isMotion && fastener.type !== 'spring'
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={selected ? 0.55 : 0.25}
      depthTest={!xray}
      transparent={xray}
      opacity={xray ? 0.9 : 1}
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
          <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
        </mesh>
      )}
    <group
      ref={group}
      renderOrder={5}
      onPointerDown={(e) => {
        e.stopPropagation()
        store.getState().selectFastener(fastener.id)
      }}
    >
      {fastener.type === 'pivot' && (
        <>
          {/* swing arc (torus hole axis rotated onto +Y) + the axis pin */}
          <mesh rotation={[Math.PI / 2, 0, 0]} key={`arc:${sweep.toFixed(2)}`}>
            <torusGeometry args={[0.085, 0.009, 10, 48, sweep]} />
            {mat}
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.006, 0.006, 0.17, 8]} />
            {mat}
          </mesh>
        </>
      )}
      {fastener.type === 'linear' && (
        <>
          {/* travel arrow along the axis, with end-stop ticks */}
          <mesh>
            <cylinderGeometry args={[0.007, 0.007, 0.17, 8]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.105, 0]}>
            <coneGeometry args={[0.022, 0.05, 10]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.105, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.022, 0.05, 10]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.135, 0]}>
            <boxGeometry args={[0.06, 0.008, 0.06]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.135, 0]}>
            <boxGeometry args={[0.06, 0.008, 0.06]} />
            {mat}
          </mesh>
        </>
      )}
      {fastener.type === 'cylindrical' && (
        <>
          {/* bearing sleeve around the shaft + a spin ring */}
          <mesh>
            <cylinderGeometry args={[0.045, 0.045, 0.13, 18, 1, true]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={selected ? 0.55 : 0.25}
              transparent
              opacity={0.55}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.055, 0.007, 8, 32]} />
            {mat}
          </mesh>
        </>
      )}
      {fastener.type === 'weld' && (
        <mesh>
          <cylinderGeometry args={[0.042, 0.042, 0.016, 20]} />
          {mat}
        </mesh>
      )}
      {fastener.type === 'bolt' && (
        <>
          <mesh>
            <cylinderGeometry args={[0.034, 0.034, 0.024, 6]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.05, 10]} />
            {mat}
          </mesh>
        </>
      )}
      {fastener.type === 'nail' && (
        <>
          <mesh>
            <cylinderGeometry args={[0.007, 0.002, 0.11, 8]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.055, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.008, 12]} />
            {mat}
          </mesh>
        </>
      )}
      {fastener.type === 'glue' && (
        <mesh scale={[1, 0.65, 1]}>
          <sphereGeometry args={[0.038, 16, 12]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={selected ? 0.55 : 0.25}
            transparent
            opacity={0.85}
            depthTest={false}
          />
        </mesh>
      )}
      {fastener.type === 'spring' && (
        <mesh>
          <sphereGeometry args={[0.03, 12, 8]} />
          {mat}
        </mesh>
      )}
    </group>
    </>
  )
}
