import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { isJointType, type Document, type Fastener, type Vec3 } from '../document/types'
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

  useFrame(() => {
    const mid = fastenerMidpoint(store.getState().doc, fastener)
    if (ref.current && mid) {
      ref.current.visible = true
      ref.current.position.set(mid[0], mid[1], mid[2])
    } else if (ref.current) {
      ref.current.visible = false
    }
  })

  return (
    <mesh
      ref={ref}
      onPointerDown={
        isJointType(fastener.type)
          ? (e) => {
              // Clicking a joint marker opens its axis/limits editor (paused).
              e.stopPropagation()
              store.getState().selectFastener(fastener.id)
            }
          : undefined
      }
    >
      <sphereGeometry args={[0.035, 12, 8]} />
      <meshStandardMaterial color="#e8a13a" emissive="#7a4d00" emissiveIntensity={0.4} />
    </mesh>
  )
}
