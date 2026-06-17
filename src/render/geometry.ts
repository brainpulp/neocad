import { STOCK } from '../document/catalog'
import type { Material, Piece } from '../document/types'

export interface PieceVisual {
  kind: 'box' | 'cylinder' | 'sphere'
  /** Geometry constructor args, in Three.js order. */
  args: number[]
  color: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

const FALLBACK_COLOR = '#cccccc'

/** Pure mapping from a piece (+ materials table) to renderable geometry/material. */
export function pieceVisual(piece: Piece, materials: Material[]): PieceVisual {
  const primitive = STOCK[piece.stockType].primitive
  const d = piece.dimensions
  const color = materials.find((m) => m.name === piece.material)?.color ?? FALLBACK_COLOR

  let kind: PieceVisual['kind']
  let args: number[]
  switch (primitive) {
    case 'box':
      kind = 'box'
      args = [d.x, d.y, d.z]
      break
    case 'cylinder':
      kind = 'cylinder'
      // Three CylinderGeometry: radiusTop, radiusBottom, height, radialSegments
      args = [d.radius, d.radius, d.height, 24]
      break
    case 'sphere':
      kind = 'sphere'
      args = [d.radius, 24, 16]
      break
  }

  return {
    kind,
    args,
    color,
    position: piece.state.transform.position,
    quaternion: piece.state.transform.rotation,
  }
}
