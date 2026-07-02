import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('bounce is capped: a rubber ball dropped from 1m rebounds under half its drop height', () => {
  const doc = emptyDocument()
  const ball = makePiece('ball', [0, 1, 0]) // rubber, raw restitution 0.8
  doc.pieces = [ball]
  const world = new PhysicsWorld(Jolt, doc)
  let touched = false
  let reboundPeak = 0
  for (let i = 0; i < 300; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    const y = ball.state.transform.position[1]
    if (!touched && y <= 0.05 + ball.dimensions.radius + 0.01) touched = true // slab top = 0.05
    if (touched) reboundPeak = Math.max(reboundPeak, y)
  }
  expect(touched).toBe(true)
  // Uncapped 0.8 restitution would rebound to ~0.64 of the drop; the cap keeps it low.
  expect(reboundPeak).toBeLessThan(0.5)
  world.dispose()
})

it('ground grips: a thrown block stops sliding instead of coasting away', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 0.2, 0]) // resting on the workbench slab
  doc.pieces = [block]
  const world = new PhysicsWorld(Jolt, doc)
  // Fling it sideways with a quick kinematic drag, then release.
  world.beginGrab(block.id)
  for (let i = 0; i < 10; i++) {
    world.moveGrab(block.id, [i * 0.03, 0.2, 0], 1 / 60) // ~1.8 m/s
    world.step(1 / 60)
  }
  world.endGrab(block.id)
  for (let i = 0; i < 180; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  const xAfter = block.state.transform.position[0]
  for (let i = 0; i < 30; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  const xLater = block.state.transform.position[0]
  // Fully at rest within 3 sim-seconds of release…
  expect(Math.abs(xLater - xAfter)).toBeLessThan(0.005)
  // …and it didn't coast far across the bench.
  expect(Math.abs(xLater)).toBeLessThan(2)
  world.dispose()
})
