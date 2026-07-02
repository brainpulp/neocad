import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3, type Mesh } from 'three'

const UP_TMP = new Vector3(0, 1, 0)
const DIR_TMP = new Vector3()
import type { Document, Fastener, Vec3 } from '../document/types'
import { localToWorld } from '../document/math'
import { useStoreApi } from '../ui/storeContext'

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

/** A small marker at the fastener's midpoint, tracking the pieces each frame. */
export function FastenerMarker({ fastener }: { fastener: Fastener }) {
  const store = useStoreApi()
  const ref = useRef<Mesh>(null)
  const coil = useRef<Mesh>(null)

  useFrame(() => {
    const doc = store.getState().doc
    const mid = fastenerMidpoint(doc, fastener)
    if (ref.current && mid) {
      ref.current.visible = true
      ref.current.position.set(mid[0], mid[1], mid[2])
    } else if (ref.current) {
      ref.current.visible = false
    }
    // Springs also draw their tether between the two live anchor points.
    if (fastener.type === 'spring' && coil.current) {
      const a = doc.pieces.find((p) => p.id === fastener.partA)
      const b = doc.pieces.find((p) => p.id === fastener.partB)
      if (a && b) {
        const pa = localToWorld(a.state.transform, fastener.anchorA ?? [0, 0, 0])
        const pb = localToWorld(b.state.transform, fastener.anchorB ?? [0, 0, 0])
        const dx = pb[0] - pa[0]
        const dy = pb[1] - pa[1]
        const dz = pb[2] - pa[2]
        const len = Math.hypot(dx, dy, dz)
        coil.current.visible = len > 1e-4
        coil.current.position.set((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2)
        coil.current.scale.set(1, Math.max(0.01, len), 1)
        coil.current.quaternion.setFromUnitVectors(
          UP_TMP,
          DIR_TMP.set(dx / len, dy / len, dz / len),
        )
        // The marker sphere sits at the tether midpoint too.
        ref.current?.position.set(coil.current.position.x, coil.current.position.y, coil.current.position.z)
      }
    }
  })

  return (
    <mesh
      ref={ref}
      onPointerDown={(e) => {
        // Clicking any fastener marker opens its inspector (joints also get
        // the on-screen axis/limits editor while paused).
        e.stopPropagation()
        store.getState().selectFastener(fastener.id)
      }}
    >
      <sphereGeometry args={[0.035, 12, 8]} />
      <meshStandardMaterial color="#e8a13a" emissive="#7a4d00" emissiveIntensity={0.4} />
      {fastener.type === 'spring' && (
        <mesh ref={coil} raycast={() => null}>
          <cylinderGeometry args={[0.012, 0.012, 1, 8, 1, true]} />
          <meshBasicMaterial color="#7a9c4e" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </mesh>
  )
}
