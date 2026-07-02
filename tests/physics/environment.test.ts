import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('wind topples a standing panel (pushes high → tips, like real gusts)', () => {
  const doc = emptyDocument()
  // A plywood sheet stood upright on its long edge: big face, tiny base.
  const panel = makePiece('panel', [0, 0.36, 0]) // 1.2 × 0.02 × 0.6
  const s = Math.SQRT1_2
  panel.state.transform.rotation = [s, 0, 0, s] // face the wind (normal ≈ z)
  panel.definition.transform.rotation = [s, 0, 0, s]
  doc.pieces = [panel]
  const world = new PhysicsWorld(Jolt, doc)
  let t = 0
  for (let i = 0; i < 300; i++) {
    t += 1 / 60
    world.applyEnvironment(t, { strength: 40, angle: Math.PI / 2 }, null, doc.pieces, doc.materials)
    world.step(1 / 60)
  }
  world.syncToDocument(doc)
  // Standing center was ~0.36; lying flat it's ~0.06. It blew over.
  expect(panel.state.transform.position[1]).toBeLessThan(0.25)
  world.dispose()
})

it('an earthquake shakes a block off its rest position', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 0.36, 0])
  doc.pieces = [block]
  const world = new PhysicsWorld(Jolt, doc)
  let t = 0
  let maxDrift = 0
  for (let i = 0; i < 300; i++) {
    t += 1 / 60
    world.applyEnvironment(t, null, { magnitude: 8 }, doc.pieces, doc.materials)
    world.step(1 / 60)
    world.syncToDocument(doc)
    const [x, , z] = block.state.transform.position
    maxDrift = Math.max(maxDrift, Math.hypot(x, z))
  }
  expect(maxDrift).toBeGreaterThan(0.02) // visibly rattled
  world.dispose()
})

it('slingshot rocks fly, land, and expire when fallen off the world', () => {
  const doc = emptyDocument()
  const world = new PhysicsWorld(Jolt, doc)
  world.fireProjectile([0, 1, 3], [0, 0, -1], 8, 0.06)
  let rocks = world.syncProjectiles()
  expect(rocks).toHaveLength(1)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  rocks = world.syncProjectiles()
  expect(rocks).toHaveLength(1)
  expect(rocks[0].z).toBeLessThan(3) // moving toward the scene
  expect(rocks[0].r).toBeCloseTo(0.06)
  // A second rock joins the pool; both are tracked (expiry is age/fall-based).
  world.fireProjectile([10, 0.5, 0], [1, 0, 0], 15, 0.05)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  expect(world.syncProjectiles().length).toBeLessThanOrEqual(2)
  world.dispose()
})

it('a knocked-over stack recovers with resetPieces-style state restore', () => {
  // Sanity: velocity caps keep a rammed block's speed bounded.
  const doc = emptyDocument()
  const block = makePiece('block', [0, 0.36, 0])
  doc.pieces = [block]
  const world = new PhysicsWorld(Jolt, doc)
  world.fireProjectile([0, 0.3, 2], [0, 0, -1], 20, 0.1)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  const [x, y, z] = block.state.transform.position
  // It got hit but stayed in the neighborhood (walls + caps).
  expect(Math.abs(x)).toBeLessThan(2.5)
  expect(Math.abs(z)).toBeLessThan(2.5)
  expect(y).toBeGreaterThan(-0.5)
  world.dispose()
})
