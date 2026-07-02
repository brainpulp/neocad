import { forwardRef, useEffect, useMemo } from 'react'
import { BackSide, type BufferGeometry, type Mesh } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { STOCK } from '../document/catalog'
import { maxExtent, pieceVisual } from './geometry'
import { buildVisual } from './mechanical'
import type { Material, Piece } from '../document/types'

interface Props {
  piece: Piece
  materials: Material[]
  selected?: boolean
  highlighted?: boolean
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
}

// Selection = orange outline; proximity join target = green outline. Shading is
// never altered — the outline is the whole signal.
const SELECT_COLOR = '#ff8a00'
const HIGHLIGHT_COLOR = '#2ecc71'

/**
 * Per-axis scale that expands the piece by a uniform world-space rim `t` on every
 * side (an even outline on thin panels and long rods alike, where a single uniform
 * scale would be lopsided).
 */
function outlineScale(piece: Piece, t: number): [number, number, number] {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return [(d.x + 2 * t) / d.x, (d.y + 2 * t) / d.y, (d.z + 2 * t) / d.z]
    case 'cylinder':
      return [(d.radius + t) / d.radius, (d.height + 2 * t) / d.height, (d.radius + t) / d.radius]
    case 'sphere': {
      const s = (d.radius + t) / d.radius
      return [s, s, s]
    }
  }
}

/** Renders one piece. The mesh ref lets the physics loop drive its transform imperatively. */
export const PieceMesh = forwardRef<Mesh, Props>(function PieceMesh(
  { piece, materials, selected, highlighted, onPointerDown, onPointerMove, onPointerUp, onPointerOut },
  ref,
) {
  const v = pieceVisual(piece, materials)

  // Mechanical stock renders a custom silhouette (teeth, groove, lobe); rebuilt
  // only when its dimensions change, disposed when replaced.
  const dimsKey = Object.values(piece.dimensions).join(',')
  const customGeo = useMemo<BufferGeometry | null>(
    () => (v.visual ? buildVisual(v.visual, piece.dimensions) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.visual, dimsKey],
  )
  useEffect(() => () => customGeo?.dispose(), [customGeo])

  const geometryJsx = customGeo ? (
    <primitive object={customGeo} attach="geometry" />
  ) : (
    <>
      {v.kind === 'box' && <boxGeometry args={v.args as [number, number, number]} />}
      {v.kind === 'cylinder' && (
        <cylinderGeometry args={v.args as [number, number, number, number]} />
      )}
      {v.kind === 'sphere' && <sphereGeometry args={v.args as [number, number, number]} />}
    </>
  )

  // Outline rim thickness scales with the piece so pins and panels both read
  // clearly — a fine line, not a halo.
  const rim = Math.min(0.005, Math.max(0.0015, maxExtent(piece) * 0.008))
  const showOutline = selected || highlighted

  return (
    <mesh
      ref={ref}
      position={v.position}
      quaternion={v.quaternion}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOut={onPointerOut}
    >
      {geometryJsx}
      <meshStandardMaterial color={v.color} roughness={0.75} metalness={0.05} />
      {showOutline && (
        // Inverted-hull outline: same geometry, expanded, back faces only.
        <mesh scale={outlineScale(piece, rim)} raycast={() => null}>
          {customGeo ? <primitive object={customGeo} attach="geometry" /> : geometryJsx}
          <meshBasicMaterial color={selected ? SELECT_COLOR : HIGHLIGHT_COLOR} side={BackSide} />
        </mesh>
      )}
    </mesh>
  )
})
