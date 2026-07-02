import { STOCK } from './catalog'
import { distance } from './math'
import type { Piece, Vec3 } from './types'

/**
 * Joint features: the places on a piece where a joint naturally lives. The joint
 * tool snaps clicks to the nearest feature instead of using raw surface points,
 * so "hinge at the end of the plank" and "gear on the axle" come out right.
 * All coordinates are piece-LOCAL.
 */

export type FeatureKind = 'bore' | 'axis' | 'end' | 'center' | 'face' | 'edge'

export interface JointFeature {
  kind: FeatureKind
  label: string
  /** Anchor point, piece-local. */
  point: Vec3
  /** Natural joint axis, piece-local (null = no preferred axis). */
  axis: Vec3 | null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Candidate features for a click at `local` (piece-local point). Line-like
 * features (centerlines, edges) project the click onto themselves, so clicking
 * anywhere along a rod snaps to the rod's axis right there.
 */
export function candidateFeatures(piece: Piece, local: Vec3): JointFeature[] {
  const d = piece.dimensions
  const def = STOCK[piece.stockType]
  switch (def.primitive) {
    case 'sphere':
      return [{ kind: 'center', label: 'Center', point: [0, 0, 0], axis: null }]
    case 'cylinder': {
      const h2 = d.height / 2
      const up: Vec3 = [0, 1, 0]
      // Toothed / grooved parts join at their bore: the hole IS the joint.
      const spinPart = def.visual != null
      const online: Vec3 = [0, clamp(local[1], -h2, h2), 0]
      const feats: JointFeature[] = [
        {
          kind: spinPart ? 'bore' : 'axis',
          label: spinPart ? 'Bore' : 'Centerline',
          point: spinPart ? [0, 0, 0] : online,
          axis: up,
        },
        { kind: 'end', label: 'End', point: [0, h2, 0], axis: up },
        { kind: 'end', label: 'End', point: [0, -h2, 0], axis: up },
      ]
      if (def.visual === 'cam') {
        // The cam's bore is offset from center — that offset is the whole point.
        const off = -Math.min(d.lobe ?? d.radius * 0.5, d.radius * 0.6)
        feats[0] = { kind: 'bore', label: 'Bore', point: [off, 0, 0], axis: up }
      }
      return feats
    }
    case 'wedge': {
      // Ramp: bottom face, the slope face, and the apex edge (a natural hinge line).
      const x = d.x / 2
      const y = d.y / 2
      const z = d.z / 2
      const lz = clamp(local[2], -z, z)
      const slopeNormal: Vec3 = ((): Vec3 => {
        const n: Vec3 = [d.y, d.x, 0]
        const l = Math.hypot(n[0], n[1])
        return [n[0] / l, n[1] / l, 0]
      })()
      return [
        { kind: 'center', label: 'Center', point: [0, 0, 0], axis: null },
        { kind: 'face', label: 'Bottom', point: [0, -y, 0], axis: [0, 1, 0] },
        { kind: 'face', label: 'Slope', point: [0, 0, 0], axis: slopeNormal },
        { kind: 'edge', label: 'Apex edge', point: [-x, y, lz], axis: [0, 0, 1] },
        { kind: 'edge', label: 'Base edge', point: [x, -y, lz], axis: [0, 0, 1] },
        { kind: 'edge', label: 'Base edge', point: [-x, -y, lz], axis: [0, 0, 1] },
      ]
    }
    case 'box': {
      const x = d.x / 2
      const y = d.y / 2
      const z = d.z / 2
      const feats: JointFeature[] = [
        { kind: 'center', label: 'Center', point: [0, 0, 0], axis: null },
      ]
      const faceAxes: [Vec3, Vec3][] = [
        [[x, 0, 0], [1, 0, 0]],
        [[-x, 0, 0], [1, 0, 0]],
        [[0, y, 0], [0, 1, 0]],
        [[0, -y, 0], [0, 1, 0]],
        [[0, 0, z], [0, 0, 1]],
        [[0, 0, -z], [0, 0, 1]],
      ]
      for (const [point, axis] of faceAxes)
        feats.push({ kind: 'face', label: 'Face center', point, axis })
      // Edges project the click along themselves (a hinge goes anywhere on an edge).
      const lx = clamp(local[0], -x, x)
      const ly = clamp(local[1], -y, y)
      const lz = clamp(local[2], -z, z)
      for (const sy of [y, -y])
        for (const sz of [z, -z])
          feats.push({ kind: 'edge', label: 'Edge', point: [lx, sy, sz], axis: [1, 0, 0] })
      for (const sx of [x, -x])
        for (const sz of [z, -z])
          feats.push({ kind: 'edge', label: 'Edge', point: [sx, ly, sz], axis: [0, 1, 0] })
      for (const sx of [x, -x])
        for (const sy of [y, -y])
          feats.push({ kind: 'edge', label: 'Edge', point: [sx, sy, lz], axis: [0, 0, 1] })
      return feats
    }
  }
}

// Attraction weights: lower = snappier. Bores pull hardest (they're the joint),
// ends beat the centerline near tips, generic geometry competes evenly.
const WEIGHT: Record<FeatureKind, number> = {
  bore: 0.5,
  end: 0.75,
  axis: 0.9,
  center: 1,
  face: 1,
  edge: 0.85,
}

/** The feature a click at `local` (piece-local) snaps to. */
export function snapToFeature(piece: Piece, local: Vec3): JointFeature {
  let best: JointFeature | null = null
  let bestScore = Infinity
  for (const f of candidateFeatures(piece, local)) {
    const score = distance(f.point, local) * WEIGHT[f.kind]
    if (score < bestScore) {
      bestScore = score
      best = f
    }
  }
  return best!
}

/**
 * Suggested joint type for a feature pairing. Bore-on-shaft spins AND slides;
 * anything on an edge hinges; flat-on-flat slides; otherwise a rigid weld is
 * probably what the builder meant.
 */
export function suggestJoint(
  a: JointFeature,
  b?: JointFeature,
): 'pivot' | 'cylindrical' | 'linear' | 'weld' {
  const kinds = b ? [a.kind, b.kind] : [a.kind]
  if (kinds.includes('bore')) return 'cylindrical'
  if (kinds.includes('edge')) return 'pivot'
  if (kinds.includes('axis') || kinds.includes('end')) return 'pivot'
  if (b && a.kind === 'face' && b.kind === 'face') return 'linear'
  return 'weld'
}
