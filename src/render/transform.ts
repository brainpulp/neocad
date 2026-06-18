import { snapToGrid } from './snap'
import { STOCK } from '../document/catalog'
import type { Piece, Quat, Vec3 } from '../document/types'

export const MIN_DIM = 0.005

export interface DecomposedTransform {
  position: Vec3
  quaternion: Quat
  scale: Vec3
}

function clamp(v: number): number {
  return Math.max(MIN_DIM, v)
}

/** Map a per-axis scale factor onto a piece's dimensions, per its primitive. */
function scaleDimensions(piece: Piece, scale: Vec3): Record<string, number> {
  const d = piece.dimensions
  const [sx, sy, sz] = scale
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return { x: clamp(d.x * sx), y: clamp(d.y * sy), z: clamp(d.z * sz) }
    case 'cylinder':
      return { radius: clamp(d.radius * Math.max(sx, sz)), height: clamp(d.height * sy) }
    case 'sphere':
      return { radius: clamp(d.radius * Math.max(sx, sy, sz)) }
  }
}

/**
 * Build a document patch from a gizmo's decomposed world transform: snapped position
 * (X/Z), rotation passthrough, and new dimensions from the scale factor. Writes the
 * same pose to both Definition and State (the piece's new rest pose).
 */
export function transformPatch(piece: Piece, t: DecomposedTransform): Partial<Piece> {
  const position = snapToGrid(t.position)
  const rotation = t.quaternion
  return {
    dimensions: scaleDimensions(piece, t.scale),
    definition: { transform: { position, rotation } },
    state: { transform: { position, rotation } },
  }
}
