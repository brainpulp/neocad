import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { PhysicsWorld } from '../../src/physics/integration'

let Jolt: JoltModule
beforeAll(async () => {
  Jolt = await initJolt()
})

it('a weld holds a hanging piece up when its partner is anchored', () => {
  const doc = emptyDocument()
  const top = makePiece('block', [0, 3, 0])
  top.anchored = true
  const bottom = makePiece('block', [0, 2.6, 0]) // just below, within weld reach
  doc.pieces.push(top, bottom)
  doc.fasteners.push({ id: 'f1', type: 'weld', partA: top.id, partB: bottom.id })
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  // Without the weld, bottom would fall to ~0.13; welded to an anchored top it stays high.
  expect(doc.pieces[1].state.transform.position[1]).toBeGreaterThan(2.0)
  world.dispose()
})

it('a fastener referencing a missing piece is skipped, not fatal', () => {
  const doc = emptyDocument()
  const a = makePiece('block', [0, 1, 0])
  doc.pieces.push(a)
  doc.fasteners.push({ id: 'f1', type: 'weld', partA: a.id, partB: 'ghost' })
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 30; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  expect(doc.pieces).toHaveLength(1)
  world.dispose()
})
