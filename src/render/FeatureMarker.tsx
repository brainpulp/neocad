import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Group, Vector3 } from 'three'
import { localDirToWorld, localToWorld } from '../document/math'
import type { JointAnchor } from '../document/store'
import { useStoreApi } from '../ui/storeContext'

const UP = new Vector3(0, 1, 0)
const tmp = new Vector3()

/**
 * Snap-preview / picked-point marker for the joint tool: a dot on the snapped
 * feature, its axis as a line (when the feature has one), and the feature's
 * name. Tracks the piece each frame so it stays glued during simulation.
 */
export function FeatureMarker({ anchor, color }: { anchor: JointAnchor; color: string }) {
  const store = useStoreApi()
  const ref = useRef<Group>(null)

  useFrame(() => {
    const g = ref.current
    if (!g) return
    const piece = store.getState().doc.pieces.find((p) => p.id === anchor.pieceId)
    if (!piece) {
      g.visible = false
      return
    }
    g.visible = true
    const t = piece.state.transform
    const [px, py, pz] = localToWorld(t, anchor.feature.point)
    g.position.set(px, py, pz)
    if (anchor.feature.axis) {
      const [ax, ay, az] = localDirToWorld(t, anchor.feature.axis)
      g.quaternion.setFromUnitVectors(UP, tmp.set(ax, ay, az).normalize())
    }
  })

  return (
    <group ref={ref}>
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.016, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {anchor.feature.axis && (
        <mesh renderOrder={999}>
          <cylinderGeometry args={[0.003, 0.003, 0.6, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} depthTest={false} />
        </mesh>
      )}
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="feature-badge">{anchor.feature.label}</div>
      </Html>
    </group>
  )
}
