import { useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { STOCK } from '../document/catalog'
import { geometryFor } from './geometry'
import { snapToGrid } from './snap'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import type { Vec3 } from '../document/types'

// Height the held piece is committed at, so it visibly drops into the live world.
const DROP_HEIGHT = 1.2

function GeometryFor({ kind, args }: { kind: string; args: number[] }) {
  if (kind === 'box') return <boxGeometry args={args as [number, number, number]} />
  if (kind === 'cylinder') return <cylinderGeometry args={args as [number, number, number, number]} />
  return <sphereGeometry args={args as [number, number, number]} />
}

/**
 * Held-piece placement: while a stock tool is active, a translucent ghost follows
 * the cursor on the ground plane (snapped to grid) and is inert. Clicking commits
 * it as a real piece, which then drops and settles in the running world.
 */
export function HeldPiece() {
  const activeTool = useDocStore((s) => s.activeTool)
  const store = useStoreApi()
  const [pos, setPos] = useState<Vec3>([0, DROP_HEIGHT, 0])

  if (!activeTool) return null

  const geo = geometryFor(STOCK[activeTool].primitive, STOCK[activeTool].defaultDimensions)

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const snapped = snapToGrid([e.point.x, DROP_HEIGHT, e.point.z])
    setPos(snapped)
  }
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const snapped = snapToGrid([e.point.x, DROP_HEIGHT, e.point.z])
    store.getState().commitHeldAt(snapped)
  }

  return (
    <>
      {/* Transparent ground-plane catcher for pointer position + click-to-commit.
          Must stay visible (three.js skips invisible meshes when raycasting). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={onMove} onPointerDown={onDown}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Translucent ghost preview (inert). */}
      <mesh position={pos}>
        <GeometryFor kind={geo.kind} args={geo.args} />
        <meshStandardMaterial color="#2f6df0" transparent opacity={0.45} />
      </mesh>
    </>
  )
}
