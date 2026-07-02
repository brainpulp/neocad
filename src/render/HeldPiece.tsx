import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { FASTENERS, STOCK } from '../document/catalog'
import { geometryFor } from './geometry'
import { wedgeGeometry } from './mechanical'
import { snapToGrid } from './snap'
import { useDocStore, useStoreApi } from '../ui/storeContext'

// Height the held piece is committed at over empty ground, so it visibly drops in.
export const DROP_HEIGHT = 1.2

function GeometryFor({ kind, args }: { kind: string; args: number[] }) {
  const wedge = useMemo(
    () => (kind === 'wedge' ? wedgeGeometry(args[0], args[1], args[2]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, args.join(',')],
  )
  if (kind === 'box') return <boxGeometry args={args as [number, number, number]} />
  if (kind === 'cylinder') return <cylinderGeometry args={args as [number, number, number, number]} />
  if (wedge) return <primitive object={wedge} attach="geometry" />
  return <sphereGeometry args={args as [number, number, number]} />
}

/**
 * Held-piece placement (proximity-aware, spec §13.1). While a stock tool is active a
 * translucent ghost follows the cursor; over empty ground it sits at DROP_HEIGHT, over
 * an existing piece it snaps to that surface and a "⊕ Weld" badge appears. Committing
 * there places the piece AND auto-joins it to the target — no palette trip. The ground
 * plane below catches empty-space pointer events (pieces handle their own — see Scene).
 */
export function HeldPiece() {
  const activeTool = useDocStore((s) => s.activeTool)
  const fastenTool = useDocStore((s) => s.fastenTool)
  const heldPos = useDocStore((s) => s.heldPos)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const store = useStoreApi()

  if (!activeTool) return null

  const geo = geometryFor(STOCK[activeTool].primitive, STOCK[activeTool].defaultDimensions)
  // With a palette fastener pre-picked the drop joins immediately with it;
  // otherwise dropping opens the attach dialog.
  const joinLabel = fastenTool ? FASTENERS[fastenTool].label : 'Attach…'

  // Over empty ground: position the ghost at DROP_HEIGHT and clear any proximity target.
  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    store.getState().setHeldPos(snapToGrid([e.point.x, DROP_HEIGHT, e.point.z]))
    store.getState().setProximityTarget(null)
  }
  const onGroundDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    store.getState().commitHeldAt(snapToGrid([e.point.x, DROP_HEIGHT, e.point.z]))
  }

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={onGroundMove} onPointerDown={onGroundDown}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={heldPos}>
        <GeometryFor kind={geo.kind} args={geo.args} />
        <meshStandardMaterial
          color={proximityTarget ? '#2ecc71' : '#2f6df0'}
          transparent
          opacity={0.45}
        />
        {proximityTarget && (
          <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
            <div className="join-badge">⊕ {joinLabel}</div>
          </Html>
        )}
      </mesh>
    </>
  )
}
