import type { ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { FASTENERS, STOCK } from '../document/catalog'
import { MECHANISMS, mechanismBounds } from '../document/mechanisms'
import { geometryFor } from './geometry'
import { wedgeGeometry } from './mechanical'
import { snapToGrid } from './snap'
import { useDocStore, useStoreApi } from '../ui/storeContext'

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

/** Half-height below a piece's center at rest (identity rotation). */
function halfDown(primitive: string, d: Record<string, number>): number {
  switch (primitive) {
    case 'box':
    case 'wedge':
      return d.y / 2
    case 'cylinder':
      return d.height / 2
    default:
      return d.radius
  }
}

/**
 * Context-aware placement ghost. A translucent preview follows the cursor and
 * sits exactly where the piece will LAND — resting on the bench (or on top of
 * a piece it's hovering, which offers an attach). What you see is where it
 * goes, so nothing drops from the sky onto other stock. The same catcher also
 * places a whole MECHANISM at the clicked spot (its footprint shown as a ghost).
 */
export function HeldPiece() {
  const activeTool = useDocStore((s) => s.activeTool)
  const placingId = useDocStore((s) => s.placingMechanismId)
  const fastenTool = useDocStore((s) => s.fastenTool)
  const heldPos = useDocStore((s) => s.heldPos)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  const store = useStoreApi()

  // Mechanism footprint (built once per selection).
  const mech = useMemo(() => {
    const def = MECHANISMS.find((m) => m.id === placingId)
    if (!def) return null
    const build = def.build()
    return { def, bounds: mechanismBounds(build) }
  }, [placingId])

  if (!activeTool && !mech) return null

  const slabTop = sandbox?.thickness ?? 0
  const onBench = (x: number, z: number) =>
    !sandbox || (Math.abs(x) <= sandbox.size / 2 && Math.abs(z) <= sandbox.size / 2)

  // ---- Mechanism placement ----
  if (mech) {
    const { hx, hz, top } = mech.bounds
    const groundMove = (e: ThreeEvent<PointerEvent>) =>
      store.getState().setHeldPos([e.point.x, 0, e.point.z])
    const groundDown = (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      store.getState().placeMechanismAt([e.point.x, 0, e.point.z])
    }
    const [gx, , gz] = heldPos
    return (
      <>
        <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={groundMove} onPointerDown={groundDown}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh position={[gx, slabTop + top / 2, gz]}>
          <boxGeometry args={[hx * 2, top, hz * 2]} />
          <meshStandardMaterial color="#2f6df0" transparent opacity={0.18} depthWrite={false} />
          <Html center style={{ pointerEvents: 'none' }}>
            <div className="join-badge">⊕ {mech.def.label}</div>
          </Html>
        </mesh>
      </>
    )
  }

  // ---- Stock placement ----
  const def = STOCK[activeTool!]
  const geo = geometryFor(def.primitive, def.defaultDimensions)
  const joinLabel = fastenTool ? FASTENERS[fastenTool].label : 'Attach…'
  const rest = halfDown(def.primitive, def.defaultDimensions)

  // Over empty ground: rest the ghost ON the surface at the cursor (no sky-drop).
  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    const floor = onBench(e.point.x, e.point.z) ? slabTop : 0
    store.getState().setHeldPos(snapToGrid([e.point.x, floor + rest, e.point.z]))
    store.getState().setProximityTarget(null)
  }
  const onGroundDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const floor = onBench(e.point.x, e.point.z) ? slabTop : 0
    store.getState().commitHeldAt(snapToGrid([e.point.x, floor + rest, e.point.z]))
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
          <Html center style={{ pointerEvents: 'none' }}>
            <div className="join-badge">⊕ {joinLabel}</div>
          </Html>
        )}
      </mesh>
    </>
  )
}
