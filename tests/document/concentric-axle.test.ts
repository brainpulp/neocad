import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { snapToFeature } from '../../src/document/features'
import { planJoint, planAxleThroughBores } from '../../src/document/joints'
import { localDirToWorld, localToWorld } from '../../src/document/math'

describe('concentric axle join (any diameter)', () => {
  it('a thin dowel joins co-axial to a fat rod end regardless of diameter, with a gap advisory', () => {
    const rod = makePiece('rod', [0, 1, 0]) // radius 0.05, vertical
    rod.dimensions = { radius: 0.25, height: 0.6 } // fat
    rod.anchored = true
    const dowel = makePiece('dowel', [0.8, 1, 0]) // radius 0.02, thin
    dowel.dimensions = { radius: 0.02, height: 0.6 }
    const featRod = snapToFeature(rod, [0.24, 0.1, 0]) // barrel/axis
    const featDowel = snapToFeature(dowel, [0.02, 0.1, 0])
    const plan = planJoint(rod, featRod, dowel, featDowel, 'cylindrical', 'f')
    expect(plan.veto).toBeUndefined()
    expect(plan.moverId).toBe(dowel.id)
    // Dowel axis is now co-axial (parallel) with the rod's vertical axis.
    const axisWorld = localDirToWorld(plan.moverTransform!, plan.fastener!.axisA!)
    expect(Math.abs(axisWorld[1])).toBeCloseTo(1, 3)
    // The mismatched radii (0.25 vs 0.02) are announced.
    expect(plan.advisory).toMatch(/gap/i)
  })

  it('equal-diameter concentric join has no gap advisory', () => {
    const a = makePiece('rod', [0, 1, 0])
    a.anchored = true
    const b = makePiece('rod', [0.8, 1, 0])
    const fa = snapToFeature(a, [0.05, 0.1, 0])
    const fb = snapToFeature(b, [0.05, 0.1, 0])
    const plan = planJoint(a, fa, b, fb, 'cylindrical', 'f')
    expect(plan.advisory).toBeUndefined()
  })
})

describe('auto-axle through two holes', () => {
  it('joining two gear bores with Axle drops in a connecting shaft', () => {
    const s = createDocStore()
    const g1 = makePiece('gear', [0, 0.5, 0])
    g1.anchored = true
    const g2 = makePiece('gear', [0.8, 0.5, 0])
    s.getState().addPiece(g1)
    s.getState().addPiece(g2)
    s.getState().setTool('joint')
    s.getState().setJointType('cylindrical')
    // Click each gear's rim → snaps to its bore.
    s.getState().jointClick(g1.id, [0.12, 0.5, 0])
    s.getState().jointClick(g2.id, [0.92, 0.5, 0])
    const st = s.getState()
    // A new axle piece was added, and BOTH gears are jointed to it (2 joints).
    const axle = st.doc.pieces.find((p) => p.stockType === 'axle')
    expect(axle).toBeDefined()
    expect(st.doc.fasteners).toHaveLength(2)
    expect(st.doc.fasteners.every((f) => f.partA === axle!.id)).toBe(true)
    expect(st.jointNotice).toMatch(/axle/i)
    // The second gear was pulled co-axial with the first (same x/z centreline).
    const movedG2 = st.doc.pieces.find((p) => p.id === g2.id)!
    const boreWorld = localToWorld(movedG2.state.transform, [0, 0, 0])
    expect(boreWorld[0]).toBeCloseTo(0, 2)
    expect(boreWorld[2]).toBeCloseTo(0, 2)
    // The two gears are spaced along the shaft, not jammed together.
    const g1p = st.doc.pieces.find((p) => p.id === g1.id)!.state.transform.position
    const dist = Math.hypot(...g1p.map((v, i) => v - movedG2.state.transform.position[i]))
    expect(dist).toBeGreaterThan(0.05)
  })

  it('planAxleThroughBores refuses when the second part is anchored', () => {
    const g1 = makePiece('gear', [0, 0.5, 0])
    const g2 = makePiece('gear', [0.8, 0.5, 0])
    g2.anchored = true
    const axle = makePiece('axle', [0, 0, 0])
    const f1 = snapToFeature(g1, [0.12, 0, 0])
    const f2 = snapToFeature(g2, [0.12, 0, 0])
    expect(planAxleThroughBores(g1, f1, g2, f2, axle, 'a', 'b')).toBeNull()
  })
})
