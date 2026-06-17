import { forwardRef } from 'react'
import type { Mesh } from 'three'
import { pieceVisual } from './geometry'
import type { Material, Piece } from '../document/types'

interface Props {
  piece: Piece
  materials: Material[]
}

/** Renders one piece. The mesh ref lets the physics loop drive its transform imperatively. */
export const PieceMesh = forwardRef<Mesh, Props>(function PieceMesh({ piece, materials }, ref) {
  const v = pieceVisual(piece, materials)
  return (
    <mesh
      ref={ref}
      position={v.position}
      quaternion={v.quaternion}
      castShadow
      receiveShadow
    >
      {v.kind === 'box' && <boxGeometry args={v.args as [number, number, number]} />}
      {v.kind === 'cylinder' && (
        <cylinderGeometry args={v.args as [number, number, number, number]} />
      )}
      {v.kind === 'sphere' && <sphereGeometry args={v.args as [number, number, number]} />}
      <meshStandardMaterial color={v.color} />
    </mesh>
  )
})
