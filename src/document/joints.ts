import { STOCK } from './catalog'
import { piecesOverlap, surfaceAnchor } from './contact'
import type { JointFeature } from './features'
import {
  add,
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
  worldToLocal,
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

/**
 * The world joint frame (pivot + axis) from a fastener, using part A's live
 * pose (anchors/axis are stored in A's local frame).
 */
export function jointFrame(f: Fastener, pieceA: Piece): { pivot: Vec3; axis: Vec3 } {
  return {
    pivot: localToWorld(pieceA.state.transform, f.anchorA ?? [0, 0, 0]),
    axis: normalize(localDirToWorld(pieceA.state.transform, f.axisA ?? [0, 1, 0])),
  }
}

/** Rigidly turn a piece by `angle` about a world axis line through `pivot`. */
export function rotatePieceAboutAxis(piece: Piece, pivot: Vec3, axis: Vec3, angle: number): Transform {
  const q = quatFromAxisAngle(axis, angle)
  const t = piece.state.transform
  return {
    position: add(pivot, quatRotate(q, sub(t.position, pivot))),
    rotation: quatMultiply(q, t.rotation),
  }
}

/** Slide a piece by `delta` along a world axis (keeps orientation). */
export function slidePieceAlongAxis(piece: Piece, axis: Vec3, delta: number): Transform {
  const t = piece.state.transform
  return { position: add(t.position, scale(axis, delta)), rotation: [...t.rotation] }
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
  /** Null when the plan is vetoed (nothing to create). */
  fastener: Fastener | null
  /** Why the join was refused: both parts fixed, or the landing would collide. */
  veto?: 'fixed' | 'collision'
}


/**
 * Plan a joint between two picked points (A first — the part that STAYS; B
 * second — the part being brought in). See
 * docs/superpowers/specs/2026-07-04-joints-literal-redesign.md.
 *
 * Landing rule: SURFACE CONTACT. The mover is rotated so its clicked surface
 * faces the stationary clicked surface (outward normals opposed), rolled square
 * (twistSnap), and translated so the two surface points kiss. Joining never
 * buries a part: the old rule aligned feature AXES, which for shafts means
 * "inside each other" (the dowel-swallowed-by-the-log bug).
 *
 * Exception — shaft into ring: a true bore feature meeting a cylinder shaft
 * still engages co-axially (gear onto axle). Exempt from the collision veto
 * because mechanical stock collides as solid cylinders until drilling lands.
 *
 * Veto: both parts fixed, or a landing that would interpenetrate any piece.
 */
export function planJoint(
  pieceA: Piece,
  featA: JointFeature,
  pieceB: Piece,
  featB: JointFeature,
  type: FastenerType,
  fastenerId: string,
  opts: { clickA?: Vec3; clickB?: Vec3; allPieces?: Piece[] } = {},
): JointPlan {
  const ta = pieceA.state.transform
  const tb = pieceB.state.transform

  // A spring tethers the two points exactly where they are — nothing moves,
  // the current separation becomes the rest length.
  if (type === 'spring') {
    const worldA = localToWorld(ta, featA.point)
    const worldB = localToWorld(tb, featB.point)
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

  // Who moves: the SECOND-clicked part comes to the first. A fixed part never
  // moves; both fixed = no join (predictable beats clever — the old smaller-
  // piece heuristic was a patch over unpredictability).
  const mover: 'a' | 'b' | null = !pieceB.anchored ? 'b' : !pieceA.anchored ? 'a' : null
  if (!mover) return { moverId: null, moverTransform: null, fastener: null, veto: 'fixed' }

  const moverPiece = mover === 'a' ? pieceA : pieceB
  const statPiece = mover === 'a' ? pieceB : pieceA
  const moverFeat = mover === 'a' ? featA : featB
  const statFeat = mover === 'a' ? featB : featA
  const tMov = moverPiece.state.transform
  const tStat = statPiece.state.transform

  // Shaft-into-ring: a bore meeting a cylinder shaft engages co-axially.
  const isCyl = (p: Piece) => STOCK[p.stockType].primitive === 'cylinder'
  const shaftKinds = new Set(['bore', 'axis', 'end'])
  const ringPair =
    (featA.kind === 'bore' || featB.kind === 'bore') &&
    isCyl(pieceA) &&
    isCyl(pieceB) &&
    shaftKinds.has(featA.kind) &&
    shaftKinds.has(featB.kind)

  let rotation: Quat
  let position: Vec3
  let anchorMover: Vec3
  let anchorStat: Vec3
  let jointAxis: Vec3

  if (ringPair) {
    // Legacy co-axial engagement: align the mover's feature axis with the
    // stationary one, square the roll, and bring the feature points together.
    const ownAxis = moverFeat.axis ? localDirToWorld(tMov, moverFeat.axis) : null
    const statAxis = statFeat.axis ? localDirToWorld(tStat, statFeat.axis) : null
    rotation = tMov.rotation
    if (ownAxis && statAxis) {
      rotation = twistSnap(
        quatMultiply(quatFromTo(ownAxis, statAxis), tMov.rotation),
        tStat.rotation,
        normalize(statAxis),
      )
    }
    const target = localToWorld(tStat, statFeat.point)
    position = sub(target, quatRotate(rotation, moverFeat.point))
    anchorMover = moverFeat.point
    anchorStat = statFeat.point
    jointAxis = statAxis ?? ownAxis ?? [0, 1, 0]
  } else {
    // SURFACE CONTACT landing.
    const clickMov = (mover === 'a' ? opts.clickA : opts.clickB) ?? moverFeat.point
    const clickStat = (mover === 'a' ? opts.clickB : opts.clickA) ?? statFeat.point
    const sMov = surfaceAnchor(moverPiece, clickMov)
    const sStat = surfaceAnchor(statPiece, clickStat)
    const nStat = localDirToWorld(tStat, sStat.normal)
    const nMov = localDirToWorld(tMov, sMov.normal)
    const opposed: Vec3 = [-nStat[0], -nStat[1], -nStat[2]]
    rotation = twistSnap(
      quatMultiply(quatFromTo(nMov, opposed), tMov.rotation),
      tStat.rotation,
      nStat,
    )
    const statPoint = localToWorld(tStat, sStat.point)
    position = sub(statPoint, quatRotate(rotation, sMov.point))
    anchorMover = sMov.point
    anchorStat = sStat.point
    jointAxis = nStat

    // A hinge/axle picked on an EDGE pivots about that edge line, not the
    // contact normal — the door lands flush on the post AND swings on its edge.
    const edgeSide = moverFeat.kind === 'edge' ? 'mover' : statFeat.kind === 'edge' ? 'stat' : null
    if (edgeSide && (type === 'pivot' || type === 'cylindrical')) {
      const edgeFeat = edgeSide === 'mover' ? moverFeat : statFeat
      const edgeT = edgeSide === 'mover' ? { position, rotation } : tStat
      const edgeAxis = localDirToWorld(edgeT, edgeFeat.axis ?? [0, 1, 0])
      const inPlane = sub(edgeAxis, scale(nStat, dot(edgeAxis, nStat)))
      if (length(inPlane) > 0.35) jointAxis = normalize(inPlane)
      const edgePointWorld = localToWorld(edgeT, edgeFeat.point)
      if (edgeSide === 'mover') {
        anchorMover = edgeFeat.point
        anchorStat = worldToLocal(tStat, edgePointWorld)
      } else {
        anchorStat = edgeFeat.point
        anchorMover = worldToLocal({ position, rotation }, edgePointWorld)
      }
    }

    // A slider on a surface travels IN the contact plane, not along its normal:
    // pick the stationary piece's longest in-plane principal axis.
    if (type === 'linear') {
      const dims = statPiece.dimensions
      const candidates: [Vec3, number][] = [
        [[1, 0, 0], dims.x ?? dims.radius * 2],
        [[0, 1, 0], dims.y ?? dims.height ?? dims.radius * 2],
        [[0, 0, 1], dims.z ?? dims.radius * 2],
      ]
      let best: Vec3 | null = null
      let bestSize = -1
      for (const [dirLocal, size] of candidates) {
        const w = localDirToWorld(tStat, dirLocal)
        if (Math.abs(dot(w, nStat)) > 0.9) continue // that's the normal itself
        if (size > bestSize) {
          bestSize = size
          best = w
        }
      }
      if (best) jointAxis = normalize(sub(best, scale(nStat, dot(best, nStat))))
    } else if (type === 'cylindrical' && !edgeSide && isCyl(statPiece)) {
      // Spinning against a shaft's flank: the motion axis is the shaft's axis.
      jointAxis = localDirToWorld(tStat, [0, 1, 0])
    }

    // The veto: a landing that interpenetrates any piece is refused outright.
    // (Touch and millimetre kisses pass — piecesOverlap erodes by a margin.)
    const moverT: Transform = { position, rotation }
    const others = opts.allPieces ?? [pieceA, pieceB]
    for (const other of others) {
      if (other.id === moverPiece.id) continue
      if (piecesOverlap(moverPiece, moverT, other, other.state.transform)) {
        return { moverId: null, moverTransform: null, fastener: null, veto: 'collision' }
      }
    }
  }

  const moverTransform: Transform = { position, rotation }
  const finalTa = mover === 'a' ? moverTransform : ta

  const fastener: Fastener = {
    id: fastenerId,
    type,
    partA: pieceA.id,
    partB: pieceB.id,
    anchorA: mover === 'a' ? anchorMover : anchorStat,
    anchorB: mover === 'a' ? anchorStat : anchorMover,
    // Expressed in A's frame AFTER any repositioning, so compile-time
    // local→world conversion reproduces the joint axis exactly.
    axisA: worldDirToLocal(finalTa, jointAxis),
  }

  if (type === 'linear' || type === 'cylindrical') {
    // End stops: the sliding anchor must stay within the stationary piece (the
    // guide you slide along).
    const axisGuideLocal = worldDirToLocal(tStat, jointAxis)
    const half = halfExtentAlong(statPiece, axisGuideLocal)
    const offset = dot(anchorStat, axisGuideLocal)
    fastener.slideMin = -half - offset
    fastener.slideMax = half - offset
  }

  return { moverId: moverPiece.id, moverTransform, fastener }
}
