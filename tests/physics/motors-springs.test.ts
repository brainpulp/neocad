import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { MECHANISMS } from '../../src/document/mechanisms'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

it('a motorized pivot spins its arm', () => {
  const doc = emptyDocument()
  const post = makePiece('block', [0, 0.55, 0])
  post.dimensions = { x: 0.06, y: 1, z: 0.06 }
  post.anchored = true
  const arm = makePiece('slat', [0.2, 1.05, 0.05])
  arm.dimensions = { x: 0.4, y: 0.02, z: 0.05 }
  doc.pieces = [post, arm]
  doc.fasteners = [
    {
      id: 'f_m',
      type: 'pivot',
      partA: arm.id,
      partB: post.id,
      anchorA: [-0.2, 0, 0],
      anchorB: [0, 0.5, 0.05],
      axisA: [0, 0, 1],
      motor: { enabled: true, velocity: 4, maxForce: 60 },
    },
  ]
  const world = new PhysicsWorld(Jolt, doc)
  // Sample orientation along the way — a full revolution returns near identity,
  // so total displacement alone can't prove spinning.
  let maxTilt = 0
  for (let i = 0; i < 90; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    const [qx, qy, qz] = arm.state.transform.rotation
    maxTilt = Math.max(maxTilt, Math.hypot(qx, qy, qz))
  }
  // At some point mid-spin the arm was far from its start orientation.
  expect(maxTilt).toBeGreaterThan(0.5)
  world.dispose()
})

it('a spring holds a hanging block near its rest length, bouncing', () => {
  const doc = emptyDocument()
  const hook = makePiece('block', [0, 1.5, 0])
  hook.dimensions = { x: 0.1, y: 0.1, z: 0.1 }
  hook.anchored = true
  const weight = makePiece('block', [0, 1.0, 0])
  weight.dimensions = { x: 0.15, y: 0.15, z: 0.15 }
  doc.pieces = [hook, weight]
  doc.fasteners = [
    {
      id: 'f_s',
      type: 'spring',
      partA: weight.id,
      partB: hook.id,
      anchorA: [0, 0.075, 0],
      anchorB: [0, -0.05, 0],
      axisA: [0, 1, 0],
      spring: { frequency: 3, damping: 0.15, restLength: 0.37 },
    },
  ]
  const world = new PhysicsWorld(Jolt, doc)
  let minY = Infinity
  for (let i = 0; i < 300; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    minY = Math.min(minY, weight.state.transform.position[1])
  }
  // It sagged below rest (spring stretches under load) but did NOT fall to the
  // bench — the tether holds.
  expect(minY).toBeLessThan(1.0)
  expect(minY).toBeGreaterThan(0.4)
  world.dispose()
})

it('every library mechanism compiles and survives 2s of simulation', () => {
  for (const m of MECHANISMS) {
    const doc = emptyDocument()
    const { pieces, fasteners } = m.build()
    doc.pieces = pieces
    doc.fasteners = fasteners
    const world = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 120; i++) world.step(1 / 60)
    world.syncToDocument(doc)
    for (const p of doc.pieces) {
      for (const v of p.state.transform.position) expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(p.state.transform.position[0])).toBeLessThan(5)
      expect(p.state.transform.position[1]).toBeGreaterThan(-1)
    }
    world.dispose()
  }
})

it('the crank-slider actually reciprocates its carriage', () => {
  const doc = emptyDocument()
  const { pieces, fasteners } = MECHANISMS.find((m) => m.id === 'crank-slider')!.build()
  doc.pieces = pieces
  doc.fasteners = fasteners
  const carriage = doc.pieces.find((p) => p.name === 'Carriage')!
  const world = new PhysicsWorld(Jolt, doc)
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < 360; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    minX = Math.min(minX, carriage.state.transform.position[0])
    maxX = Math.max(maxX, carriage.state.transform.position[0])
  }
  // The motor turned the crank; the rod pushed the carriage back and forth.
  expect(maxX - minX).toBeGreaterThan(0.1)
  world.dispose()
})
