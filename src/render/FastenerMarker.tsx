import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'
import type { Document, Fastener, Vec3 } from '../document/types'
import { useStoreApi } from '../ui/storeContext'

/** Midpoint between the two fastened pieces' State positions, or null if one is missing. */
export function fastenerMidpoint(doc: Document, fastener: Fastener): Vec3 | null {
  const a = doc.pieces.find((p) => p.id === fastener.partA)
  const b = doc.pieces.find((p) => p.id === fastener.partB)
  if (!a || !b) return null
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
    <mesh ref={ref}>
      <sphereGeometry args={[0.035, 12, 8]} />
      <meshStandardMaterial color="#e8a13a" emissive="#7a4d00" emissiveIntensity={0.4} />
    </mesh>
  )
}
