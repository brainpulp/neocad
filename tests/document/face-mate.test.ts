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
    expect(plan.moverId).toBe(a.id)
    const moved = { ...a, state: { transform: plan.moverTransform! }, definition: { transform: plan.moverTransform! } }

    // A's +x face normal must OPPOSE B's -x face normal (they face each other).
    const nA = localDirToWorld(plan.moverTransform!, [1, 0, 0])
    const nB = localDirToWorld(b.state.transform, [-1, 0, 0])
    expect(nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]).toBeLessThan(-0.98)

    // The two face centers coincide (faces kiss).
    const faceA = localToWorld(plan.moverTransform!, [0.15, 0, 0])
    const faceB = localToWorld(b.state.transform, [-0.15, 0, 0])
    for (let i = 0; i < 3; i++) expect(faceA[i]).toBeCloseTo(faceB[i], 4)

    // Centers are ~0.3 apart (two half-widths) — not overlapping.
    const dist = Math.hypot(
      ...(moved.state.transform.position.map((v, i) => v - b.state.transform.position[i]) as Vec3),
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
    const axisWorld = localDirToWorld(plan.moverTransform!, plan.fastener.axisA!)
    // Gear axis co-axial with the vertical axle (parallel, same direction).
    expect(Math.abs(axisWorld[1])).toBeCloseTo(1, 3)
  })
})
