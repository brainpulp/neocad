import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument, type Rope } from '../../src/document/types'
import { makePiece, nextFastenerId } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

/** A weight hung from a fixed anchor by one rope; returns how far it settled. */
function hangDrop(elasticity: number): number {
  const doc = emptyDocument()
  const anchor = makePiece('block', [0, 1.5, 0])
  anchor.anchored = true
  anchor.dimensions = { x: 0.1, y: 0.1, z: 0.1 }
  const weight = makePiece('ball', [0, 1.0, 0])
  weight.dimensions = { radius: 0.06 }
  weight.material = 'steel'
  doc.pieces = [anchor, weight]
  const rope: Rope = {
    id: 'r1',
    name: 'r',
    start: [0, 1.45, 0],
    end: [0, 1.05, 0],
    segments: 12,
    radius: 0.01,
    slack: 1,
    stiffness: 1,
    elasticity,
    looped: false,
    attachStart: { pieceId: anchor.id, anchor: [0, -0.05, 0] },
    attachEnd: { pieceId: weight.id, anchor: [0, 0.06, 0] },
    material: 'hemp',
  }
  doc.ropes = [rope]
  const world = new PhysicsWorld(Jolt, doc)
  let low = Infinity
  for (let i = 0; i < 240; i++) {
    world.step(1 / 60)
    world.updateRopeAttachments(doc)
    world.syncToDocument(doc)
    low = Math.min(low, doc.pieces[1].state.transform.position[1])
  }
  const nudge = fastenerId()
  void nudge
  return low
}
function fastenerId() {
  return nextFastenerId()
}

it('an inextensible rope holds a steel weight up; a bungee lets it sag lower', () => {
  const stiff = hangDrop(0) // real rope
  const bungee = hangDrop(1) // maximally springy
  // Both hold the weight off the ground, but the elastic one stretches further down.
  expect(stiff).toBeGreaterThan(0.3)
  expect(bungee).toBeLessThan(stiff - 0.03)
})
