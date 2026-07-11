import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument, type Document, type Fastener } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

function docWithJoint(type: Fastener['type']): Document {
  const doc = emptyDocument()
  const post = makePiece('rod', [0, 0.5, 0])
  post.anchored = true
  const arm = makePiece('joist', [0.3, 1.0, 0])
  doc.pieces = [post, arm]
  doc.fasteners = [
    {
      id: 'f_test',
      type,
      partA: post.id,
      partB: arm.id,
      // Anchors near the top of the post, in each piece's local frame.
      anchorA: [0, 0.5, 0],
      anchorB: [-0.3, 0, 0],
      axisA: [0, 0, 1],
    },
  ]
  return doc
}

function stepAndCheck(doc: Document): void {
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 60; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  for (const p of doc.pieces) {
    for (const v of p.state.transform.position) expect(Number.isFinite(v)).toBe(true)
    // Constrained piece must not have exploded away.
    expect(Math.abs(p.state.transform.position[0])).toBeLessThan(5)
    expect(Math.abs(p.state.transform.position[1])).toBeLessThan(5)
  }
  world.dispose()
}

it('a pivot joint compiles to a hinge and stays bounded under gravity', () => {
  stepAndCheck(docWithJoint('pivot'))
})

it('a linear joint compiles to a slider and stays bounded under gravity', () => {
  stepAndCheck(docWithJoint('linear'))
})

it('a cylindrical joint compiles to a 6-DOF and stays bounded under gravity', () => {
  stepAndCheck(docWithJoint('cylindrical'))
})

it('a pivot keeps the anchor points together while the arm swings', () => {
  const doc = docWithJoint('pivot')
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  const arm = doc.pieces[1]
  // The arm's anchored end must stay near the post top (0, 1, 0): the hinge holds.
  const [ax, ay] = arm.state.transform.position
  const dist = Math.hypot(ax, ay - 1)
  // Arm half-length is 0.045 in x... its center swings on a 0.3 radius around the anchor.
  expect(dist).toBeLessThan(0.5)
  world.dispose()
})

it('grab: a dragged piece follows the pointer kinematically and releases dynamic', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 2, 0])
  doc.pieces = [block]
  const world = new PhysicsWorld(Jolt, doc)
  expect(world.beginGrab(block.id)).toBe(true)
  for (let i = 0; i < 30; i++) {
    world.moveGrab(block.id, [1, 2, 0], 1 / 60)
    world.step(1 / 60)
  }
  world.syncToDocument(doc)
  // Kinematic drag pulled it toward the target and gravity did NOT drop it.
  expect(block.state.transform.position[0]).toBeGreaterThan(0.5)
  expect(block.state.transform.position[1]).toBeCloseTo(2, 1)
  world.endGrab(block.id)
  for (let i = 0; i < 30; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  // Dynamic again: gravity resumes.
  expect(block.state.transform.position[1]).toBeLessThan(1.9)
  world.dispose()
})

it('anchored pieces refuse the grab', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 1, 0])
  block.anchored = true
  doc.pieces = [block]
  const world = new PhysicsWorld(Jolt, doc)
  expect(world.beginGrab(block.id)).toBe(false)
  world.dispose()
})

it('mechanical stock compiles to bodies (gear on axle scene)', () => {
  const doc = emptyDocument()
  const axle = makePiece('axle', [0, 0.5, 0])
  axle.anchored = true
  const gear = makePiece('gear', [0, 0.8, 0])
  doc.pieces = [axle, gear]
  doc.fasteners = [
    { id: 'f_g', type: 'cylindrical', partA: gear.id, partB: axle.id, anchorA: [0, 0, 0], anchorB: [0, 0.3, 0], axisA: [0, 1, 0] },
  ]
  stepAndCheck(doc)
})
