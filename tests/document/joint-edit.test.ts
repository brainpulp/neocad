import { it, expect } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { flipJointAxis, swapJointEnds, planJoint } from '../../src/document/joints'
import { snapToFeature } from '../../src/document/features'
import { localDirToWorld } from '../../src/document/math'

function gearOnAxle() {
  const axle = makePiece('axle', [0, 1, 0])
  axle.anchored = true
  const gear = makePiece('gear', [0.4, 1.2, 0])
  const plan = planJoint(
    gear,
    snapToFeature(gear, [0.07, 0, 0]),
    axle,
    snapToFeature(axle, [0.015, 0.1, 0]),
    'cylindrical',
    'f_x',
  )
  // Apply the mover transform so world math is consistent.
  gear.state.transform = structuredClone(plan.moverTransform!)
  gear.definition.transform = structuredClone(plan.moverTransform!)
  return { gear, axle, f: plan.fastener! }
}

it('flipJointAxis reverses the axis and mirrors the slide range', () => {
  const { f } = gearOnAxle()
  const flipped = { ...f, ...flipJointAxis(f) }
  expect(flipped.axisA![1]).toBeCloseTo(-f.axisA![1])
  expect(flipped.slideMin).toBeCloseTo(-f.slideMax!)
  expect(flipped.slideMax).toBeCloseTo(-f.slideMin!)
})

it('swapJointEnds exchanges roles but preserves the world axis', () => {
  const { gear, axle, f } = gearOnAxle()
  const axisWorldBefore = localDirToWorld(gear.state.transform, f.axisA!)
  const swapped = { ...f, ...swapJointEnds(f, gear, axle) }
  expect(swapped.partA).toBe(axle.id)
  expect(swapped.partB).toBe(gear.id)
  expect(swapped.anchorA).toEqual(f.anchorB)
  const axisWorldAfter = localDirToWorld(axle.state.transform, swapped.axisA!)
  for (let i = 0; i < 3; i++) expect(axisWorldAfter[i]).toBeCloseTo(axisWorldBefore[i])
})
