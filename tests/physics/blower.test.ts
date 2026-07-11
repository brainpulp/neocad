import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('the blower topples the panel it points at, not one off-axis', () => {
  const doc = emptyDocument()
  // Two identical plywood sheets stood upright, faces toward the jet.
  const s = Math.SQRT1_2
  const stand = (z: number) => {
    const p = makePiece('panel', [0, 0.36, z]) // 1.2 × 0.02 × 0.6
    p.state.transform.rotation = [s, 0, 0, s]
    p.definition.transform.rotation = [s, 0, 0, s]
    return p
  }
  const target = stand(0)
  // Off to the SIDE of the jet (not downwind, where the blown target would hit it).
  const bystander = makePiece('block', [1.4, 0.2, 0])
  doc.pieces = [target, bystander]
  const world = new PhysicsWorld(Jolt, doc)
  // Nozzle 1.2 m upwind at panel height, blowing along +z straight at the target.
  for (let i = 0; i < 300; i++) {
    world.applyBlower([0, 0.36, -1.2], [0, 0, 1], 60, doc.pieces)
    world.step(1 / 60)
  }
  world.syncToDocument(doc)
  // The jet visibly shoved the target downwind (slid and/or toppled)…
  const moved =
    target.state.transform.position[2] > 0.15 || target.state.transform.position[1] < 0.25
  expect(moved).toBe(true)
  // …while the off-axis block stayed put.
  expect(Math.abs(bystander.state.transform.position[0] - 1.4)).toBeLessThan(0.05)
  expect(Math.abs(bystander.state.transform.position[2])).toBeLessThan(0.05)
  world.dispose()
})

it('anchored pieces ignore the blower', () => {
  const doc = emptyDocument()
  const post = makePiece('block', [0, 0.2, 0])
  post.anchored = true
  doc.pieces = [post]
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 60; i++) {
    world.applyBlower([-1.5, 0.2, 0], [1, 0, 0], 150, doc.pieces)
    world.step(1 / 60)
  }
  world.syncToDocument(doc)
  expect(post.state.transform.position[0]).toBeCloseTo(0)
  world.dispose()
})
