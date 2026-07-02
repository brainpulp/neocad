import { STOCK } from './catalog'
import type { JointFeature } from './features'
import {
  dot,
  localDirToWorld,
  localToWorld,
  normalize,
  quatFromTo,
  quatMultiply,
  quatRotate,
  sub,
  worldDirToLocal,
  length,
} from './math'
import type { Fastener, JointType, Piece, Transform, Vec3 } from './types'

/** Half-extent of a piece along a piece-local direction (box support function). */
function halfExtentAlong(piece: Piece, dirLocal: Vec3): number {
  const d = piece.dimensions
  const [x, y, z] = dirLocal
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return (Math.abs(x) * d.x + Math.abs(y) * d.y + Math.abs(z) * d.z) / 2
    case 'cylinder':
      return Math.abs(y) * (d.height / 2) + Math.hypot(x, z) * d.radius
    case 'sphere':
      return d.radius
  }
}

export interface JointPlan {
  /** Piece to reposition so the joint starts satisfied (null = nothing moves). */
  moverId: string | null
  moverTransform: Transform | null
  fastener: Fastener
}

/**
 * Plan a joint between two snapped features: pick the world axis, move one piece
 * so the two feature points coincide (and axes align), and produce the fastener
 * with piece-local anchors. Moving a piece BEFORE constraining means the solver
 * never has to yank parts together on Run.
 *
 * Which piece moves: the non-anchored one, preferring A (the first-picked piece —
 * "grab the gear, click the axle" moves the gear). Both anchored = neither moves.
 */
export function planJoint(
  pieceA: Piece,
  featA: JointFeature,
  pieceB: Piece,
  featB: JointFeature,
  type: JointType,
  fastenerId: string,
): JointPlan {
  const ta = pieceA.state.transform
  const tb = pieceB.state.transform
  const worldA = localToWorld(ta, featA.point)
  const worldB = localToWorld(tb, featB.point)
  const axisAWorld = featA.axis ? localDirToWorld(ta, featA.axis) : null
  const axisBWorld = featB.axis ? localDirToWorld(tb, featB.axis) : null

  const mover: 'a' | 'b' | null = !pieceA.anchored ? 'a' : !pieceB.anchored ? 'b' : null

  // The joint axis: prefer the stationary piece's feature axis (slide the gear
  // onto the AXLE's axis), then the mover's, then the line between the points.
  const gap = sub(worldB, worldA)
  const fallback: Vec3 = length(gap) < 1e-4 ? [0, 1, 0] : normalize(gap)
  const stationaryAxis = mover === 'a' ? axisBWorld : axisAWorld
  const moverAxis = mover === 'a' ? axisAWorld : axisBWorld
  const axisWorld = stationaryAxis ?? moverAxis ?? fallback

  let moverId: string | null = null
  let moverTransform: Transform | null = null
  let finalTa = ta

  if (mover) {
    const piece = mover === 'a' ? pieceA : pieceB
    const feat = mover === 'a' ? featA : featB
    const t = piece.state.transform
    const ownAxisWorld = mover === 'a' ? axisAWorld : axisBWorld
    // Rotate so the mover's feature axis lies along the joint axis (when it has one),
    // then translate so its feature point lands on the stationary feature point.
    const rotation =
      ownAxisWorld && stationaryAxis
        ? quatMultiply(quatFromTo(ownAxisWorld, axisWorld), t.rotation)
        : t.rotation
    const target = mover === 'a' ? worldB : worldA
    const position = sub(target, quatRotate(rotation, feat.point))
    moverId = piece.id
    moverTransform = { position, rotation }
    if (mover === 'a') finalTa = moverTransform
  }

  const fastener: Fastener = {
    id: fastenerId,
    type,
    partA: pieceA.id,
    partB: pieceB.id,
    anchorA: featA.point,
    anchorB: featB.point,
    // Expressed in A's frame AFTER any repositioning, so compile-time
    // local→world conversion reproduces the joint axis exactly.
    axisA: worldDirToLocal(finalTa, axisWorld),
  }

  if (type === 'linear' || type === 'cylindrical') {
    // End stops: the sliding anchor must stay within the guide piece — the
    // stationary part (the shaft you slide along), or B as a default.
    const guide = mover === 'a' ? pieceB : mover === 'b' ? pieceA : pieceB
    const guideFeat = guide === pieceB ? featB : featA
    const axisGuideLocal = worldDirToLocal(guide.state.transform, axisWorld)
    const half = halfExtentAlong(guide, axisGuideLocal)
    // Anchor's offset from the guide's center along the axis.
    const offset = dot(guideFeat.point, axisGuideLocal)
    fastener.slideMin = -half - offset
    fastener.slideMax = half - offset
  }

  return { moverId, moverTransform, fastener }
}
