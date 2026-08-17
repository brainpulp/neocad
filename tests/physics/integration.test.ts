import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { PhysicsWorld } from '../../src/physics/integration'

let Jolt: JoltModule
beforeAll(async () => {
  Jolt = await initJolt()
})

it('a dropped block lands and rests on the ground (deterministic, fixed dt)', () => {
  const doc = emptyDocument()
  doc.pieces.push(makePiece('block', [0, 3, 0])) // 0.3 cube (half-extent 0.15)
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 180; i++) world.step(1 / 60) // 3 seconds
  world.syncToDocument(doc)
  const y = doc.pieces[0].state.transform.position[1]
  // Half-extent 0.15 on the 0.05-thick workbench slab (minus Jolt's ~0.02m slop).
  expect(y).toBeGreaterThan(0.17)
  expect(y).toBeLessThan(0.21)
  world.dispose()
})

it('an anchored piece does not move', () => {
  const doc = emptyDocument()
  const b = makePiece('block', [0, 3, 0])
  b.anchored = true
  doc.pieces.push(b)
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 60; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  expect(doc.pieces[0].state.transform.position[1]).toBeCloseTo(3, 5)
  world.dispose()
})

it('is deterministic: identical runs produce identical rest positions', () => {
  const run = () => {
    const doc = emptyDocument()
    doc.pieces.push(makePiece('block', [0.05, 2.5, -0.03]))
    const w = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 150; i++) w.step(1 / 60)
    w.syncToDocument(doc)
    w.dispose()
    return doc.pieces[0].state.transform.position
  }
  expect(run()).toEqual(run())
})
