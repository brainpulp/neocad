import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('pulling a rod by its END pivots it (the grab point leads, the body swings)', () => {
  const doc = emptyDocument()
  // A rod lying along x on the bench.
  const rod = makePiece('joist', [0, 0.1, 0]) // 0.9 long in x
  doc.pieces = [rod]
  const world = new PhysicsWorld(Jolt, doc)
  // Grab the +x end and tow it upward and sideways.
  const local = world.beginPull(rod.id, [0.44, 0.1, 0])
  expect(local).not.toBeNull()
  expect(local![0]).toBeGreaterThan(0.4) // grabbed near the end, not the center
  // Hoist the end well above the rod's length — it must hang steeply.
  for (let i = 0; i < 360; i++) {
    world.applyPull([0.44, 1.2, 0], 1 / 60)
    world.step(1 / 60)
  }
  world.syncToDocument(doc)
  const [, , , qw] = rod.state.transform.rotation
  // The rod rotated substantially — a center-grab carry would keep it level.
  expect(Math.abs(qw)).toBeLessThan(0.98)
  world.endPull()
  world.dispose()
})

it('the force budget makes a heavy slab lag behind a light block', () => {
  const chase = (material: string) => {
    const doc = emptyDocument()
    const piece = makePiece('block', [0, 0.2, 0])
    piece.material = material
    doc.pieces = [piece]
    const world = new PhysicsWorld(Jolt, doc)
    world.beginPull(piece.id, [0, 0.35, 0])
    // Sample EARLY (0.4 s in): given long enough, both arrive at the cursor —
    // the weight difference shows in how fast they get moving.
    for (let i = 0; i < 25; i++) {
      world.applyPull([1.5, 0.35, 0], 1 / 60)
      world.step(1 / 60)
    }
    world.syncToDocument(doc)
    world.dispose()
    return piece.state.transform.position[0]
  }
  const cork = chase('cork') // ~6.5 kg
  const granite = chase('granite') // ~73 kg — over the ~90 kg-force budget with friction
  expect(cork).toBeGreaterThan(granite + 0.1)
})

it('endPull clamps a slingshot release', () => {
  const doc = emptyDocument()
  const ball = makePiece('ball', [0, 0.5, 0])
  doc.pieces = [ball]
  const world = new PhysicsWorld(Jolt, doc)
  world.beginPull(ball.id, [0, 0.5, 0])
  // Yank hard for a few frames to build speed, then release.
  for (let i = 0; i < 20; i++) {
    world.applyPull([3, 0.5, 0], 1 / 60)
    world.step(1 / 60)
  }
  world.endPull()
  world.syncToDocument(doc)
  const atRelease = ball.state.transform.position[0]
  world.step(1 / 60)
  world.syncToDocument(doc)
  // Release speed is clamped to 3 m/s → at most 5 cm in the next step.
  expect(ball.state.transform.position[0] - atRelease).toBeLessThan(0.06)
  world.dispose()
})
