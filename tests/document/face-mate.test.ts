import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { snapToFeature } from '../../src/document/features'
import { planJoint } from '../../src/document/joints'
import { localToWorld, localDirToWorld, worldToLocal } from '../../src/document/math'
import type { Vec3 } from '../../src/document/types'

/** Signed gap between two boxes along the mate normal — negative = interpenetrating. */
describe('face-to-face mate (the "stick two boards together" case)', () => {
  it('welding two block faces brings them FLUSH, opposed, not clipping', () => {
    const a = makePiece('block', [-0.6, 0.2, 0]) // 0.3³
    // B rotated 30° yaw and offset, to force a real relocate+rotate.
    const b = makePiece('block', [0.7, 0.35, 0.3])
    const s = Math.sin(Math.PI / 12)
    const c = Math.cos(Math.PI / 12)
    b.state.transform.rotation = [0, s, 0, c]
    b.definition.transform.rotation = [0, s, 0, c]

    // Click A's +x face and B's -x face (world points on those faces).
    const featA = snapToFeature(a, worldToLocal(a.state.transform, [-0.45, 0.2, 0]))
    const bMinusXWorld = localToWorld(b.state.transform, [-0.15, 0, 0])
    const featB = snapToFeature(b, worldToLocal(b.state.transform, bMinusXWorld))
    expect(featA.kind).toBe('face')
    expect(featB.kind).toBe('face')

    const plan = planJoint(a, featA, b, featB, 'weld', 'f1')
    // Second-clicked comes to the first: B moves, A stays.
    expect(plan.moverId).toBe(b.id)

    // B's -x face normal must OPPOSE A's +x face normal (they face each other).
    const nB = localDirToWorld(plan.moverTransform!, [-1, 0, 0])
    const nA: Vec3 = [1, 0, 0] // A is unrotated and stays put
    expect(nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]).toBeLessThan(-0.98)

    // The two face centers coincide (faces kiss).
    const faceB = localToWorld(plan.moverTransform!, [-0.15, 0, 0])
    const faceA = localToWorld(a.state.transform, [0.15, 0, 0])
    for (let i = 0; i < 3; i++) expect(faceB[i]).toBeCloseTo(faceA[i], 4)

    // Centers are ~0.3 apart (two half-widths) — not overlapping.
    const dist = Math.hypot(
      ...(plan.moverTransform!.position.map((v, i) => v - a.state.transform.position[i]) as Vec3),
    )
    expect(dist).toBeGreaterThan(0.25)
  })

  it('a co-axial mate (dowel into a bore) still aligns PARALLEL, unaffected', () => {
    const gear = makePiece('gear', [0.5, 0.2, 0])
    const axle = makePiece('axle', [0, 0.3, 0]) // vertical
    axle.anchored = true
    const featA = snapToFeature(gear, worldToLocal(gear.state.transform, [0.6, 0.2, 0]))
    const featB = snapToFeature(axle, worldToLocal(axle.state.transform, [0.015, 0.4, 0]))
    const plan = planJoint(gear, featA, axle, featB, 'cylindrical', 'f2')
    const axisWorld = localDirToWorld(plan.moverTransform!, plan.fastener!.axisA!)
    // Gear axis co-axial with the vertical axle (parallel, same direction).
    expect(Math.abs(axisWorld[1])).toBeCloseTo(1, 3)
  })
})

describe('joint mover choice: SECOND-clicked comes to the first', () => {
  it('drum clicked first stays; the dowel (second) relocates', () => {
    const drum = makePiece('rod', [0, 0.3, 0])
    drum.dimensions = { radius: 0.45, height: 0.5 }
    const dowel = makePiece('dowel', [1, 0.3, 0])
    dowel.dimensions = { radius: 0.02, height: 0.5 }
    const featA = snapToFeature(drum, worldToLocal(drum.state.transform, [0, 0.55, 0]))
    const featB = snapToFeature(dowel, worldToLocal(dowel.state.transform, [1, 0.5, 0]))
    const plan = planJoint(drum, featA, dowel, featB, 'cylindrical', 'f')
    expect(plan.moverId).toBe(dowel.id)
  })

  it('a fixed second piece never moves — the first comes to it instead', () => {
    const drum = makePiece('rod', [0, 0.3, 0])
    drum.dimensions = { radius: 0.45, height: 0.5 }
    drum.anchored = true
    const dowel = makePiece('dowel', [1, 0.3, 0])
    dowel.dimensions = { radius: 0.02, height: 0.5 }
    // Dowel first, anchored drum second: the dowel still moves.
    const featA = snapToFeature(dowel, worldToLocal(dowel.state.transform, [1, 0.5, 0]))
    const featB = snapToFeature(drum, worldToLocal(drum.state.transform, [0, 0.55, 0]))
    const plan = planJoint(dowel, featA, drum, featB, 'cylindrical', 'f')
    expect(plan.moverId).toBe(dowel.id)
  })

  it('both fixed → veto, nothing moves, no fastener', () => {
    const a = makePiece('block', [0, 0.15, 0])
    a.anchored = true
    const b = makePiece('block', [1, 0.15, 0])
    b.anchored = true
    const featA = snapToFeature(a, [0.15, 0, 0])
    const featB = snapToFeature(b, [-0.15, 0, 0])
    const plan = planJoint(a, featA, b, featB, 'weld', 'f')
    expect(plan.veto).toBe('fixed')
    expect(plan.fastener).toBeNull()
    expect(plan.moverId).toBeNull()
  })
})
