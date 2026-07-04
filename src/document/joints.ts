import { STOCK, pieceVolume } from './catalog'
import type { JointFeature } from './features'
import {
  cross,
  dot,
  localDirToWorld,
  localToWorld,
  normalize,
  quatFromAxisAngle,
  quatFromTo,
  quatMultiply,
  quatRotate,
  scale,
  sub,
  worldDirToLocal,
  length,
} from './math'
import type { Fastener, FastenerType, Piece, Quat, Transform, Vec3 } from './types'

/** Half-extent of a piece along a piece-local direction (box support function). */
export function halfExtentAlong(piece: Piece, dirLocal: Vec3): number {
  const d = piece.dimensions
  const [x, y, z] = dirLocal
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return (Math.abs(x) * d.x + Math.abs(y) * d.y + Math.abs(z) * d.z) / 2
    case 'cylinder':
      return Math.abs(y) * (d.height / 2) + Math.hypot(x, z) * d.radius
    case 'sphere':
      return d.radius
    case 'wedge':
      return (Math.abs(x) * d.x + Math.abs(y) * d.y + Math.abs(z) * d.z) / 2
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

/**
 * Twist correction about `axis`: aligning the primary axis still leaves the
 * mover free to be rolled arbitrarily about it, so an edge-to-edge join can
 * engage visibly twisted. Snap the roll so the mover's principal axes line up
 * with the stationary piece's nearest axes (projected into the plane ⊥ axis) —
 * mated pieces engage flush and parallel. Snap-to-nearest (≤45°) so a
 * deliberately angled piece isn't flipped to a different quadrant.
 */
function twistSnap(moverRot: Quat, stationaryRot: Quat, axis: Vec3): Quat {
  const AXES: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  // Mover reference: its principal axis most perpendicular to the joint axis.
  let ref: Vec3 | null = null
  let refLen = 0.35 // nearly parallel to the axis = unusable as a roll reference
  for (const u of AXES) {
    const w = quatRotate(moverRot, u)
    const p = sub(w, scale(axis, dot(w, axis)))
    const l = length(p)
    if (l > refLen) {
      refLen = l
      ref = normalize(p)
    }
  }
  if (!ref) return moverRot
  // Target: the stationary piece's projected axis (either sign) closest to it.
  let best: Vec3 | null = null
  let bestDot = -Infinity
  for (const u of AXES) {
    const w = quatRotate(stationaryRot, u)
    const p = sub(w, scale(axis, dot(w, axis)))
    if (length(p) < 0.35) continue
    for (const s of [1, -1]) {
      const cand = normalize(scale(p, s))
      const d = dot(cand, ref)
      if (d > bestDot) {
        bestDot = d
        best = cand
      }
    }
  }
  if (!best || bestDot > 0.9999) return moverRot
  const angle = Math.atan2(dot(cross(ref, best), axis), dot(ref, best))
  return quatMultiply(quatFromAxisAngle(axis, angle), moverRot)
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
  type: FastenerType,
  fastenerId: string,
): JointPlan {
  const ta = pieceA.state.transform
  const tb = pieceB.state.transform
  const worldA = localToWorld(ta, featA.point)
  const worldB = localToWorld(tb, featB.point)
  const axisAWorld = featA.axis ? localDirToWorld(ta, featA.axis) : null
  const axisBWorld = featB.axis ? localDirToWorld(tb, featB.axis) : null

  // A spring tethers the two points exactly where they are — nothing moves,
  // the current separation becomes the rest length.
  if (type === 'spring') {
    return {
      moverId: null,
      moverTransform: null,
      fastener: {
        id: fastenerId,
        type,
        partA: pieceA.id,
        partB: pieceB.id,
        anchorA: featA.point,
        anchorB: featB.point,
        axisA: worldDirToLocal(ta, normalize(sub(worldB, worldA))),
        spring: { frequency: 3, damping: 0.2, restLength: length(sub(worldB, worldA)) },
      },
    }
  }

  // Which piece relocates to satisfy the joint. A fixed piece never moves. When
  // BOTH are free, move the SMALLER one — you bring the dowel to the drum, not
  // the drum to the dowel (the old "first-clicked moves" rule flung big parts:
  // clicking a cylinder first rotated and slid the whole cylinder onto a dowel).
  const mover: 'a' | 'b' | null = pieceA.anchored
    ? pieceB.anchored
      ? null
      : 'b'
    : pieceB.anchored
      ? 'a'
      : pieceVolume(pieceA) <= pieceVolume(pieceB)
        ? 'a'
        : 'b'

  const gap = sub(worldB, worldA)
  const fallback: Vec3 = length(gap) < 1e-4 ? [0, 1, 0] : normalize(gap)
  const stationaryAxis = mover === 'a' ? axisBWorld : axisAWorld
  const moverAxis = mover === 'a' ? axisAWorld : axisBWorld

  // How the two features ENGAGE:
  //  • two FACES mate flush — the mover's face turns to OPPOSE the stationary
  //    face (normals anti-parallel) and the faces kiss. This is "stick two
  //    boards together" and was the big clipping bug (they aligned parallel,
  //    so the boards ended up back-to-back overlapping instead of face-to-face).
  //  • everything else (shaft→bore, peg→face, end→end, edge→edge) engages
  //    PARALLEL / co-axial (a dowel slides down a hole, a gear onto an axle).
  const faceMate = featA.kind === 'face' && featB.kind === 'face'

  // The stored MOTION axis (what the joint actually moves along/around).
  let jointAxis = stationaryAxis ?? moverAxis ?? fallback

  // A drawer sliding ON a face travels IN the face plane, not along its normal:
  // pick the guide's longest in-plane axis for the slide direction.
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
    jointAxis = localDirToWorld(guide.state.transform, best)
  }

  let moverId: string | null = null
  let moverTransform: Transform | null = null
  let finalTa = ta

  if (mover) {
    const piece = mover === 'a' ? pieceA : pieceB
    const feat = mover === 'a' ? featA : featB
    const t = piece.state.transform
    const own = mover === 'a' ? axisAWorld : axisBWorld
    const stat = mover === 'a' ? axisBWorld : axisAWorld
    const stationaryRot = (mover === 'a' ? pieceB : pieceA).state.transform.rotation
    // Rotate the mover so its feature axis engages the stationary one — opposed
    // for a face mate (flush), aligned otherwise — then square the roll so the
    // parts sit parallel, then translate so the feature points coincide.
    let rotation = t.rotation
    if (own && stat) {
      const target: Vec3 = faceMate ? [-stat[0], -stat[1], -stat[2]] : stat
      rotation = twistSnap(
        quatMultiply(quatFromTo(own, target), t.rotation),
        stationaryRot,
        normalize(target),
      )
    }
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
    axisA: worldDirToLocal(finalTa, jointAxis),
  }

  if (type === 'linear' || type === 'cylindrical') {
    // End stops: the sliding anchor must stay within the guide piece — the
    // stationary part (the shaft you slide along), or B as a default.
    const guide = mover === 'a' ? pieceB : mover === 'b' ? pieceA : pieceB
    const guideFeat = guide === pieceB ? featB : featA
    const axisGuideLocal = worldDirToLocal(guide.state.transform, jointAxis)
    const half = halfExtentAlong(guide, axisGuideLocal)
    // Anchor's offset from the guide's center along the axis.
    const offset = dot(guideFeat.point, axisGuideLocal)
    fastener.slideMin = -half - offset
    fastener.slideMax = half - offset
  }

  return { moverId, moverTransform, fastener }
}
