import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { makeShape } from '../../src/physics/shapes'

let Jolt: JoltModule
beforeAll(async () => {
  Jolt = await initJolt()
})

it('builds box, cylinder, sphere shapes', () => {
  expect(makeShape(Jolt, 'box', { x: 0.2, y: 0.2, z: 0.2 })).toBeTruthy()
  expect(makeShape(Jolt, 'cylinder', { radius: 0.1, height: 1 })).toBeTruthy()
  expect(makeShape(Jolt, 'sphere', { radius: 0.15 })).toBeTruthy()
})

it('builds a very thin box without throwing (convex radius 0)', () => {
  expect(makeShape(Jolt, 'box', { x: 0.6, y: 0.012, z: 0.1 })).toBeTruthy()
})
