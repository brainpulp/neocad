import { forwardRef } from 'react'
import type { Mesh } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { pieceVisual } from './geometry'
import type { Material, Piece } from '../document/types'

interface Props {
  piece: Piece
  materials: Material[]
  selected?: boolean
  highlighted?: boolean
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
}

/** Renders one piece. The mesh ref lets the physics loop drive its transform imperatively. */
export const PieceMesh = forwardRef<Mesh, Props>(function PieceMesh(
  { piece, materials, selected, highlighted, onPointerDown },
  ref,
) {
  const v = pieceVisual(piece, materials)
  // Selection = blue glow; proximity highlight = green glow.
  const emissive = selected ? '#2f6df0' : highlighted ? '#2ecc71' : '#000000'
  const emissiveIntensity = selected || highlighted ? 0.5 : 0
  return (
    <mesh
      ref={ref}
      position={v.position}
      quaternion={v.quaternion}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
    >
      {v.kind === 'box' && <boxGeometry args={v.args as [number, number, number]} />}
      {v.kind === 'cylinder' && (
        <cylinderGeometry args={v.args as [number, number, number, number]} />
      )}
      {v.kind === 'sphere' && <sphereGeometry args={v.args as [number, number, number]} />}
      <meshStandardMaterial color={v.color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
  )
})
