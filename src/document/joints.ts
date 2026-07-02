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

/** Reverse the joint's axis direction (slide range mirrors with it). */
export function flipJointAxis(f: Fastener): Partial<Fastener> {
  const a = f.axisA ?? [0, 1, 0]
  return {
    axisA: [-a[0], -a[1], -a[2]],
    slideMin: f.slideMax != null ? -f.slideMax : undefined,
    slideMax: f.slideMin != null ? -f.slideMin : undefined,
  }
}

/**
 * Exchange which piece is the joint's reference (SolidWorks-style mate flip).
 * The world axis is preserved; it's just re-expressed in the new part A's frame.
 */
export function swapJointEnds(f: Fastener, pieceA: Piece, pieceB: Piece): Partial<Fastener> {
  const axisWorld = localDirToWorld(pieceA.state.transform, f.axisA ?? [0, 1, 0])
  return {
    partA: f.partB,
    partB: f.partA,
    anchorA: f.anchorB,
    anchorB: f.anchorA,
    axisA: worldDirToLocal(pieceB.state.transform, axisWorld),
    // Slide is measured as part A's motion; the new A moves oppositely.
    slideMin: f.slideMax != null ? -f.slideMax : undefined,
    slideMax: f.slideMin != null ? -f.slideMin : undefined,
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
  let axisWorld = stationaryAxis ?? moverAxis ?? fallback

  // A linear joint along a face NORMAL just bounces in and out like a spring.
  // Drawers slide IN the face plane: swap to the guide's longest in-plane axis.
  const faceLinear = type === 'linear' && (featA.kind === 'face' || featB.kind === 'face')
  if (faceLinear) {
    const guide = featB.kind === 'face' ? pieceB : pieceA
    const guideFeat = featB.kind === 'face' ? featB : featA
    const n = guideFeat.axis ?? [0, 1, 0]
    const dims = guide.dimensions
    const candidates: [Vec3, number][] = [
      [[1, 0, 0], dims.x ?? dims.radius * 2],
      [[0, 1, 0], dims.y ?? dims.height ?? dims.radius * 2],
      [[0, 0, 1], dims.z ?? dims.radius * 2],
    ]
    let best: Vec3 = [1, 0, 0]
    let bestSize = -1
    for (const [dir, size] of candidates) {
      if (Math.abs(dot(dir, n)) > 0.9) continue // that's the normal itself
      if (size > bestSize) {
        bestSize = size
        best = dir
      }
    }
    axisWorld = localDirToWorld(guide.state.transform, best)
  }

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
    // Face-based linear joints skip the rotation — the mated faces stay flush
    // and the piece just slides.
    const rotation =
      ownAxisWorld && stationaryAxis && !faceLinear
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
