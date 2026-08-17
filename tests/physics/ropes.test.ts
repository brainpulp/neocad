import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument, type Rope } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

function makeRope(patch: Partial<Rope>): Rope {
  return {
    id: 'rope_t',
    name: 'Rope',
    start: [-0.4, 1, 0],
    end: [0.4, 1, 0],
    segments: 16,
    radius: 0.012,
    slack: 1.3,
    stiffness: 0.9,
    looped: false,
    attachStart: null,
    attachEnd: null,
    material: 'hemp',
    ...patch,
  }
}

it('a slack rope strung between two fixed posts sags in the middle', () => {
  const doc = emptyDocument()
  const postA = makePiece('block', [-0.4, 0.5, 0])
  postA.dimensions = { x: 0.05, y: 1, z: 0.05 }
  postA.anchored = true
  const postB = makePiece('block', [0.4, 0.5, 0])
  postB.dimensions = { x: 0.05, y: 1, z: 0.05 }
  postB.anchored = true
  doc.pieces = [postA, postB]
  doc.ropes = [
    makeRope({
      attachStart: { pieceId: postA.id, anchor: [0, 0.5, 0] },
      attachEnd: { pieceId: postB.id, anchor: [0, 0.5, 0] },
    }),
  ]
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 240; i++) {
    world.updateRopeAttachments(doc)
    world.step(1 / 60)
  }
  const pts = world.syncRopes().get('rope_t')!
  const n = pts.length / 3
  const midY = pts[Math.floor(n / 2) * 3 + 1]
  const endY = pts[1]
  // Ends held at post tops (~1.0), middle hangs clearly below.
  expect(endY).toBeGreaterThan(0.9)
  expect(midY).toBeLessThan(endY - 0.08)
  // Everything finite and above the floor.
  for (let i = 0; i < n; i++) expect(pts[i * 3 + 1]).toBeGreaterThan(-0.01)
  world.dispose()
})

it('a rope from a fixed beam HOLDS a hanging block off the ground (two-way coupling)', () => {
  const doc = emptyDocument()
  const beam = makePiece('block', [0, 1.4, 0])
  beam.dimensions = { x: 0.4, y: 0.05, z: 0.05 }
  beam.anchored = true
  const weight = makePiece('block', [0, 0.7, 0])
  weight.dimensions = { x: 0.12, y: 0.12, z: 0.12 } // pine-light so the rope can hold it
  weight.material = 'pine'
  doc.pieces = [beam, weight]
  doc.ropes = [
    makeRope({
      start: [0, 1.375, 0],
      end: [0, 0.76, 0],
      slack: 1.0,
      stiffness: 1.0,
      segments: 10,
      attachStart: { pieceId: beam.id, anchor: [0, -0.025, 0] },
      attachEnd: { pieceId: weight.id, anchor: [0, 0.06, 0] },
    }),
  ]
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 360; i++) {
    world.updateRopeAttachments(doc)
    world.step(1 / 60)
    world.syncToDocument(doc)
  }
  // The block hangs in the air: well above the slab (0.05 + 0.06 = rest-on-floor 0.11),
  // clearly suspended, not resting.
  const y = weight.state.transform.position[1]
  expect(y).toBeGreaterThan(0.3)
  expect(y).toBeLessThan(0.9)
  world.dispose()
})

it('a looped rope (belt) simulates without exploding', () => {
  const doc = emptyDocument()
  doc.ropes = [makeRope({ looped: true, start: [-0.3, 0.8, 0], end: [0.3, 0.8, 0], segments: 24 })]
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 180; i++) world.step(1 / 60)
  const pts = world.syncRopes().get('rope_t')!
  for (let i = 0; i < pts.length; i++) {
    expect(Number.isFinite(pts[i])).toBe(true)
  }
  // Fell onto the bench and stayed local.
  for (let i = 0; i < pts.length / 3; i++) {
    expect(Math.abs(pts[i * 3])).toBeLessThan(3)
    expect(pts[i * 3 + 1]).toBeGreaterThan(-0.06) // particle-radius penetration slop
  }
  world.dispose()
})
