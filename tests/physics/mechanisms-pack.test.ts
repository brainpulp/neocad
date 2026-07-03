import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { MECHANISMS } from '../../src/document/mechanisms'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

function docWith(id: string) {
  const doc = emptyDocument()
  const def = MECHANISMS.find((m) => m.id === id)!
  const { pieces, fasteners, ropes } = def.build()
  doc.pieces = pieces
  doc.fasteners = fasteners
  doc.ropes = ropes ?? []
  return doc
}

it('four-bar linkage: the driven crank makes the rocker oscillate', () => {
  const doc = docWith('four-bar')
  const world = new PhysicsWorld(Jolt, doc)
  const rocker = doc.pieces.find((p) => p.name === 'Rocker')!
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < 360; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    const qz = rocker.state.transform.rotation[2]
    minZ = Math.min(minZ, qz)
    maxZ = Math.max(maxZ, qz)
  }
  // The rocker's z-rotation swept a real arc (not jammed, not detached).
  expect(maxZ - minZ).toBeGreaterThan(0.05)
  // And it stayed on its ground pivot (didn't fly off the bench).
  expect(rocker.state.transform.position[1]).toBeGreaterThan(0.2)
  world.dispose()
})

it('catapult: press Run and the counterweight flings the payload', () => {
  const doc = docWith('catapult')
  const world = new PhysicsWorld(Jolt, doc)
  const ball = doc.pieces.find((p) => p.name === 'Payload')!
  let peak = 0
  for (let i = 0; i < 240; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    peak = Math.max(peak, ball.state.transform.position[1])
  }
  expect(peak).toBeGreaterThan(0.6) // launched well above its 0.3 m start
  world.dispose()
})

it('rope swing: the seat hangs from the ropes instead of falling', () => {
  const doc = docWith('swing')
  const world = new PhysicsWorld(Jolt, doc)
  const seat = doc.pieces.find((p) => p.name === 'Seat')!
  for (let i = 0; i < 300; i++) {
    world.step(1 / 60)
    world.updateRopeAttachments(doc)
    world.syncToDocument(doc)
  }
  // Free-falling from 0.45 m it would be on the bench (~0.07); hanging it stays up.
  expect(seat.state.transform.position[1]).toBeGreaterThan(0.25)
  world.dispose()
})
