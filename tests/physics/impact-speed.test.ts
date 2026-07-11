import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

/**
 * Regression: Jolt's OnContactAdded fires after the solver has absorbed the
 * impact, so reading live velocities reported ~0 m/s for every hit — impact
 * SOUNDS never played even though the listener fired. The listener must see
 * the PRE-step approach speed.
 */
it('a dropped block reports a real impact speed to the listener', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 1.2, 0])
  doc.pieces = [block]
  const speeds: number[] = []
  const world = new PhysicsWorld(Jolt, doc, (_a, _b, speed) => speeds.push(speed))
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  expect(speeds.length).toBeGreaterThan(0)
  // Falling ~1 m → hits at ~4 m/s. Anything above 2 proves real velocities.
  expect(Math.max(...speeds)).toBeGreaterThan(2)
  world.dispose()
})
