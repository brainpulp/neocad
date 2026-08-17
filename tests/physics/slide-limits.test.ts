import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { planJoint } from '../../src/document/joints'
import { snapToFeature } from '../../src/document/features'
import * as ops from '../../src/document/document'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('a gear on a floating axle slides to the end stop and stays ON the shaft', () => {
  const doc = emptyDocument()
  // Vertical axle floating in the air (anchored), spanning y = 0.7 … 1.3.
  const axle = makePiece('axle', [0, 1.0, 0])
  axle.anchored = true
  // Gear off to the side; the planner will pull it onto the shaft.
  const gear = makePiece('gear', [0.4, 1.2, 0])
  doc.pieces = [axle, gear]

  const featGear = snapToFeature(gear, [0.07, 0, 0]) // disc → bore
  const featAxle = snapToFeature(axle, [0.015, 0.2, 0]) // shaft at local y=0.2 (world 1.2)
  expect(featGear.kind).toBe('bore')
  expect(featAxle.kind).toBe('axis')
  const plan = planJoint(gear, featGear, axle, featAxle, 'cylindrical', 'f_slide')
  expect(plan.moverId).toBe(gear.id)
  // Apply the plan the way the store does.
  let d = ops.updatePiece(doc, gear.id, {
    definition: { transform: structuredClone(plan.moverTransform!) },
    state: { transform: structuredClone(plan.moverTransform!) },
  })
  d = ops.addFastener(d, plan.fastener!)

  // Slide limits cover exactly the shaft: anchor at +0.2 of a ±0.3 shaft.
  expect(plan.fastener!.slideMin).toBeCloseTo(-0.5, 1)
  expect(plan.fastener!.slideMax).toBeCloseTo(0.1, 1)

  const world = new PhysicsWorld(Jolt, d)
  for (let i = 0; i < 300; i++) world.step(1 / 60)
  world.syncToDocument(d)
  const g = d.pieces.find((p) => p.id === gear.id)!
  const [gx, gy, gz] = g.state.transform.position
  // Still laterally locked to the shaft…
  expect(Math.abs(gx)).toBeLessThan(0.03)
  expect(Math.abs(gz)).toBeLessThan(0.03)
  // …and it slid DOWN to the axle's bottom end (y≈0.7), not off into space
  // (the axle floats at 0.7 — well above the ground).
  expect(gy).toBeGreaterThan(0.6)
  expect(gy).toBeLessThan(0.85)
  world.dispose()
})
