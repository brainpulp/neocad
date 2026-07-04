import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import type { JointFeature } from '../../src/document/features'
import { planJoint } from '../../src/document/joints'
import { localDirToWorld, localToWorld } from '../../src/document/math'

/**
 * Edge-to-edge hinges: the two clicked edge LINES come together (axes
 * parallel, points coincident). The roll ABOUT the edge is the hinge's own
 * degree of freedom, so the mover's tilt is PRESERVED — an open lid stays
 * open; it doesn't get slammed flat by the landing.
 */
const slatEdge: JointFeature = { kind: 'edge', label: 'Edge', point: [0, -0.01, 0.045], axis: [1, 0, 0] }
const joistTopEdge: JointFeature = { kind: 'edge', label: 'Edge', point: [0, 0.0225, 0.045], axis: [1, 0, 0] }

describe('edge-to-edge landing (hinge at the meeting edges)', () => {
  it('a tilted slat keeps its tilt; its edge line lands ON the joist edge', () => {
    const joist = makePiece('joist', [0, 0.05, 0])
    joist.anchored = true
    const slat = makePiece('slat', [0, 0.5, 0.3])
    // Tilt 25° about world-x — the hinge axis itself: a legitimate open pose.
    const half = Math.sin((12.5 / 180) * Math.PI)
    slat.state.transform.rotation = [half, 0, 0, Math.cos((12.5 / 180) * Math.PI)]
    slat.definition.transform.rotation = [...slat.state.transform.rotation]

    const plan = planJoint(slat, slatEdge, joist, joistTopEdge, 'pivot', 'f_test')
    expect(plan.moverId).toBe(slat.id)
    // Roll preserved: edge axes were already parallel, so rotation is unchanged.
    const [qx, , , qw] = plan.moverTransform!.rotation
    expect(qx).toBeCloseTo(half, 5)
    expect(qw).toBeCloseTo(Math.cos((12.5 / 180) * Math.PI), 5)
    // The clicked edge points coincide: slat edge lands on the joist top edge.
    const slatEdgeWorld = localToWorld(plan.moverTransform!, slatEdge.point)
    const joistEdgeWorld = localToWorld(joist.state.transform, joistTopEdge.point)
    for (let i = 0; i < 3; i++) expect(slatEdgeWorld[i]).toBeCloseTo(joistEdgeWorld[i], 5)
    // And the hinge axis is the edge line.
    const axisWorld = localDirToWorld(plan.moverTransform!, plan.fastener!.axisA!)
    expect(Math.abs(axisWorld[0])).toBeCloseTo(1, 5)
  })

  it('a piece already square is not twisted by the landing', () => {
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
