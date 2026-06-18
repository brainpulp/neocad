import type { Document, Piece, Vec3 } from '../document/types'

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * The piece whose State center is nearest `point` within `tolerance`, or null.
 * Center-distance is the M2-simple proxy for surface contact — enough to drive the
 * proximity-fastening affordance (spec §13.1). `exclude` skips the held piece.
 */
export function nearestPiece(
  doc: Document,
  point: Vec3,
  tolerance: number,
  exclude?: Set<string>,
): Piece | null {
  let best: Piece | null = null
  let bestD = tolerance
  for (const p of doc.pieces) {
    if (exclude?.has(p.id)) continue
    const d = dist(p.state.transform.position, point)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}
