import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import type { JointFeature } from '../../src/document/features'
import { planJoint } from '../../src/document/joints'
import { quatRotate } from '../../src/document/math'
import type { Vec3 } from '../../src/document/types'

/**
 * Flush engagement: aligning only the primary joint axis leaves the mover free
 * to be rolled about it, so an edge-to-edge joint could engage visibly twisted.
 * planJoint must also snap that roll so the pieces end up parallel.
 */
const slatEdge: JointFeature = { kind: 'edge', label: 'Edge', point: [0, -0.01, 0.045], axis: [1, 0, 0] }
const joistTopEdge: JointFeature = { kind: 'edge', label: 'Edge', point: [0, 0.0225, 0.045], axis: [1, 0, 0] }

const worldAxisAligned = (rot: [number, number, number, number]) => {
  for (const u of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as Vec3[]) {
    const w = quatRotate(rot, u)
    expect(Math.max(...w.map(Math.abs))).toBeGreaterThan(0.999)
  }
}

describe('twist-snap: joints engage flush', () => {
  it('a slat twisted about the joint axis is squared up to the guide', () => {
    const joist = makePiece('joist', [0, 0.05, 0])
    joist.anchored = true
    const slat = makePiece('slat', [0, 0.5, 0.3])
    // Twist 25° about world-x — the joint axis itself, so the primary
    // axis alignment alone cannot remove it.
    const half = Math.sin((12.5 / 180) * Math.PI)
    slat.state.transform.rotation = [half, 0, 0, Math.cos((12.5 / 180) * Math.PI)]
    slat.definition.transform.rotation = [...slat.state.transform.rotation]

    const plan = planJoint(slat, slatEdge, joist, joistTopEdge, 'pivot', 'f_test')
    expect(plan.moverId).toBe(slat.id)
    // Every principal axis of the planned pose lies along a world axis: the
    // 25° roll was snapped away and the pieces engage parallel.
    worldAxisAligned(plan.moverTransform!.rotation)
  })

  it('a piece already square is not twisted by the snap', () => {
    const joist = makePiece('joist', [0, 0.05, 0])
    joist.anchored = true
    const slat = makePiece('slat', [0, 0.5, 0.3]) // identity rotation
    const plan = planJoint(slat, slatEdge, joist, joistTopEdge, 'pivot', 'f_test')
    const [qx, qy, qz, qw] = plan.moverTransform!.rotation
    expect(Math.abs(qw)).toBeGreaterThan(0.9999)
    expect(Math.abs(qx)).toBeLessThan(1e-3)
    expect(Math.abs(qy)).toBeLessThan(1e-3)
    expect(Math.abs(qz)).toBeLessThan(1e-3)
  })
})
