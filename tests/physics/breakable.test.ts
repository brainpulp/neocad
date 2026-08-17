import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece, nextFastenerId } from '../../src/document/catalog'
import type { Fastener } from '../../src/document/types'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

/** An anchored beam with a heavy steel block bonded to its underside. */
function hangingRig(type: Fastener['type']) {
  const doc = emptyDocument()
  const beam = makePiece('joist', [0, 1.2, 0])
  beam.anchored = true
  const block = makePiece('block', [0, 1.0, 0])
  block.dimensions = { x: 0.35, y: 0.35, z: 0.35 }
  block.material = 'steel' // ~337 kg → ~3300 N of pull on the bond
  doc.pieces = [beam, block]
  doc.fasteners = [{ id: nextFastenerId(), type, partA: block.id, partB: beam.id }]
  return doc
}

it('a heavy hang SNAPS weak glue (the block falls, the fastener reports broken)', () => {
  const doc = hangingRig('glue')
  const broken: string[] = []
  const world = new PhysicsWorld(Jolt, doc, undefined, (id) => broken.push(id))
  for (let i = 0; i < 90; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  const block = doc.pieces[1]
  expect(broken).toHaveLength(1)
  expect(broken[0]).toBe(doc.fasteners[0].id)
  expect(block.state.transform.position[1]).toBeLessThan(0.7) // it fell
  world.dispose()
})

it('the same load HOLDS on a weld (stronger bond)', () => {
  const doc = hangingRig('weld')
  const broken: string[] = []
  const world = new PhysicsWorld(Jolt, doc, undefined, (id) => broken.push(id))
  for (let i = 0; i < 90; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  expect(broken).toHaveLength(0)
  expect(doc.pieces[1].state.transform.position[1]).toBeGreaterThan(0.9) // still hanging
  world.dispose()
})

it('a per-fastener strength override beats the type default', () => {
  const doc = hangingRig('weld')
  doc.fasteners[0].strength = 500 // deliberately weak weld
  const broken: string[] = []
  const world = new PhysicsWorld(Jolt, doc, undefined, (id) => broken.push(id))
  for (let i = 0; i < 90; i++) world.step(1 / 60)
  expect(broken).toHaveLength(1)
  world.dispose()
})
