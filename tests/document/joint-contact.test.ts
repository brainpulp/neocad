import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { piecesOverlap } from '../../src/document/contact'
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

  it('two ROTATED cubes hinged edge-to-edge swing clear instead of vetoing', () => {
    // The user's case: yawed cubes, hinge clicked on two edges. Bringing the
    // edge lines together at the current roll overlaps the bodies — the fix
    // swings the mover about the hinge line (like opening a book) to the
    // nearest clear angle. It must NOT report "would create a collision".
    const yaw = (deg: number): [number, number, number, number] => {
      const a = (deg * Math.PI) / 180
      return [0, Math.sin(a / 2), 0, Math.cos(a / 2)]
    }
    const mk = (id: string, pos: Vec3, deg: number) => {
      const p = makePiece('block', pos)
      p.id = id
      p.dimensions = { x: 0.9, y: 0.9, z: 0.9 }
      p.state.transform.rotation = yaw(deg)
      p.definition.transform.rotation = yaw(deg)
      return p
    }
    const c1 = mk('r1', [-0.8, 0.45, 0], 25)
    const c2 = mk('r2', [0.8, 0.45, 0], -35)
    // Click near each cube's top edge facing the other cube.
    const clickL = localToWorld(c1.state.transform, [0.44, 0.44, 0])
    const clickR = localToWorld(c2.state.transform, [-0.44, 0.44, 0])
    const featL = snapToFeature(c1, worldToLocal(c1.state.transform, clickL))
    const featR = snapToFeature(c2, worldToLocal(c2.state.transform, clickR))
    expect(featL.kind).toBe('edge')
    expect(featR.kind).toBe('edge')
    const plan = planJoint(c1, featL, c2, featR, 'pivot', 'fr', {
      clickA: worldToLocal(c1.state.transform, clickL),
      clickB: worldToLocal(c2.state.transform, clickR),
      allPieces: [c1, c2],
    })
    expect(plan.veto).toBeUndefined()
    expect(plan.fastener).not.toBeNull()
    // Final pose does not interpenetrate the stationary cube.
    expect(piecesOverlap(c2, plan.moverTransform!, c1, c1.state.transform)).toBe(false)
  })

  it('edge-to-edge lands CENTERED: a short edge centers on a long one, click spots ignored', () => {
    // Joist (1.2 m edge along z) and slat (0.1 m edge along z? no — its long
    // edge along x). Use two blocks of different depth: clicks near OPPOSITE
    // ends must still land the edges midpoint-to-midpoint.
    const long = makePiece('block', [0, 0.45, 0])
    long.id = 'long'
    long.dimensions = { x: 0.9, y: 0.9, z: 2.0 } // long edge along z
    long.anchored = true
    const short = makePiece('block', [2, 0.45, 0])
    short.id = 'short'
    short.dimensions = { x: 0.9, y: 0.9, z: 0.6 }
    // Click near +z end of long's top-right edge; near -z end of short's.
    const clickLong: Vec3 = [0.44, 0.89, 0.9]
    const clickShort: Vec3 = [2 - 0.44, 0.89, -0.28]
    const featLong = snapToFeature(long, worldToLocal(long.state.transform, clickLong))
    const featShort = snapToFeature(short, worldToLocal(short.state.transform, clickShort))
    expect(featLong.kind).toBe('edge')
    expect(featShort.kind).toBe('edge')
    const plan = planJoint(long, featLong, short, featShort, 'pivot', 'fc', {
      clickA: worldToLocal(long.state.transform, clickLong),
      clickB: worldToLocal(short.state.transform, clickShort),
      allPieces: [long, short],
    })
    expect(plan.veto).toBeUndefined()
    // Centered along the edge direction (z): mover center lands at z = 0.
    expect(plan.moverTransform!.position[2]).toBeCloseTo(0, 3)
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
