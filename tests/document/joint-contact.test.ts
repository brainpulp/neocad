import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { snapToFeature } from '../../src/document/features'
import { planJoint } from '../../src/document/joints'
import { localDirToWorld, localToWorld, worldToLocal } from '../../src/document/math'
import type { Vec3 } from '../../src/document/types'

/**
 * Surface-contact landing: joining seats the clicked surfaces AGAINST each
 * other. The old rule aligned feature axes, which for shafts meant burial —
 * the dowel-swallowed-by-the-log bug this file regresses.
 */
describe('planJoint: surface-contact landing', () => {
  it('dowel side onto a fat log side lands TANGENT on the surface, not buried co-axially', () => {
    // Fat horizontal log (lying along x), anchored.
    const log = makePiece('rod', [0, 0.9, 0])
    log.dimensions = { ...log.dimensions, radius: 0.25, height: 1.2 }
    const r2 = Math.SQRT1_2
    log.state.transform.rotation = [0, 0, r2, r2] // long axis along x
    log.definition.transform.rotation = [0, 0, r2, r2]
    log.anchored = true
    // Thin dowel floating above.
    const dowel = makePiece('dowel', [0.5, 1.7, 0.1])

    // Click the TOP of the log's barrel, then the side of the dowel.
    const clickLog: Vec3 = [0, 1.15, 0]
    const clickDowel: Vec3 = [0.55, 1.75, 0.1]
    const featLog = snapToFeature(log, worldToLocal(log.state.transform, clickLog))
    const featDowel = snapToFeature(dowel, worldToLocal(dowel.state.transform, clickDowel))

    const plan = planJoint(log, featLog, dowel, featDowel, 'weld', 'f1', {
      clickA: worldToLocal(log.state.transform, clickLog),
      clickB: worldToLocal(dowel.state.transform, clickDowel),
    })
    expect(plan.veto).toBeUndefined()
    expect(plan.moverId).toBe(dowel.id)

    // The dowel's center must sit OUTSIDE the log: distance from the log's
    // axis = log radius + dowel radius (tangent), not ~0 (buried).
    const p = plan.moverTransform!.position
    const distFromLogAxis = Math.hypot(p[1] - 0.9, p[2] - 0) // log axis = x line at y=0.9,z=0
    expect(distFromLogAxis).toBeGreaterThan(0.25) // outside the log body
    expect(distFromLogAxis).toBeCloseTo(0.25 + 0.02, 2) // kissing the barrel
  })

  it('a rod END clicked onto a panel face stands the rod ON the face', () => {
    const panel = makePiece('panel', [0, 0.5, 0]) // 1.2 × 0.02 × 0.6
    panel.anchored = true
    const rod = makePiece('rod', [1, 1.5, 0]) // radius 0.05, height 1, vertical

    const clickPanel: Vec3 = [0.2, 0.51, 0.1] // top face
    const clickRodEnd: Vec3 = [1, 1.02, 0] // near the rod's bottom end
    const featPanel = snapToFeature(panel, worldToLocal(panel.state.transform, clickPanel))
    const featRod = snapToFeature(rod, worldToLocal(rod.state.transform, clickRodEnd))

    const plan = planJoint(panel, featPanel, rod, featRod, 'weld', 'f2', {
      clickA: worldToLocal(panel.state.transform, clickPanel),
      clickB: worldToLocal(rod.state.transform, clickRodEnd),
    })
    expect(plan.veto).toBeUndefined()
    expect(plan.moverId).toBe(rod.id)
    // Rod stands upright with its bottom cap on the face: center = face + h/2.
    const p = plan.moverTransform!.position
    expect(p[1]).toBeCloseTo(0.51 + 0.5, 3)
    const up = localDirToWorld(plan.moverTransform!, [0, 1, 0])
    expect(Math.abs(up[1])).toBeCloseTo(1, 3)
    // Seated where the user pointed, not at the panel's center.
    expect(p[0]).toBeCloseTo(0.2, 3)
    expect(p[2]).toBeCloseTo(0.1, 3)
  })

  it('gear bore onto an axle still engages co-axially (shaft-into-ring exemption)', () => {
    const axle = makePiece('axle', [0, 1, 0])
    axle.anchored = true
    const gear = makePiece('gear', [0.4, 1.2, 0])
    const featAxle = snapToFeature(axle, [0.015, 0.1, 0])
    const featGear = snapToFeature(gear, [0.07, 0, 0])
    expect(featGear.kind).toBe('bore')
    const plan = planJoint(axle, featAxle, gear, featGear, 'cylindrical', 'f3')
    expect(plan.veto).toBeUndefined()
    expect(plan.moverId).toBe(gear.id)
    // Gear bore ends up ON the axle centerline (x=0, z=0).
    const boreWorld = localToWorld(plan.moverTransform!, [0, 0, 0])
    expect(boreWorld[0]).toBeCloseTo(0, 3)
    expect(boreWorld[2]).toBeCloseTo(0, 3)
  })

  it('a landing that would bury the mover in a THIRD piece is vetoed', () => {
    const table = makePiece('panel', [0, 0.5, 0])
    table.anchored = true
    const rod = makePiece('rod', [2, 1.5, 0])
    // A block already sitting exactly where the rod would land.
    const squatter = makePiece('block', [0, 0.66, 0])

    const clickPanel: Vec3 = [0, 0.51, 0] // top face center — under the squatter
    const clickRodEnd: Vec3 = [2, 1.02, 0]
    const featPanel = snapToFeature(table, worldToLocal(table.state.transform, clickPanel))
    const featRod = snapToFeature(rod, worldToLocal(rod.state.transform, clickRodEnd))

    const plan = planJoint(table, featPanel, rod, featRod, 'weld', 'f4', {
      clickA: worldToLocal(table.state.transform, clickPanel),
      clickB: worldToLocal(rod.state.transform, clickRodEnd),
      allPieces: [table, rod, squatter],
    })
    expect(plan.veto).toBe('collision')
    expect(plan.fastener).toBeNull()
  })
})
