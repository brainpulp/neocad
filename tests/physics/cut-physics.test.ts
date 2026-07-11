import { it, expect, beforeAll, describe } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { initCsg } from '../../src/render/csg'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
  // The physics compiler meshes cut pieces synchronously via csgMeshSync, which
  // needs the manifold kernel loaded first (in the app, onCsgReady rebuilds once
  // it's ready — here we just await it up front).
  await initCsg()
})

describe('drilled anchored pieces collide as their real hole-punched mesh', () => {
  it('a ball drops straight THROUGH a bored anchored plate', () => {
    const doc = emptyDocument()
    doc.ground.sandbox = undefined
    // A thin anchored plate, floating, with a vertical bore wider than the ball.
    const plate = makePiece('block', [0, 1.0, 0])
    plate.dimensions = { x: 0.6, y: 0.08, z: 0.6 }
    plate.anchored = true
    plate.cuts = [{ id: 'c1', tool: 'bore', radius: 0.12, axis: 'y', offset: [0, 0] }]
    // A ball thinner than the Ø0.24 bore, dropped from above, aimed at the hole.
    const ball = makePiece('ball', [0, 1.7, 0])
    ball.dimensions = { radius: 0.08 }
    doc.pieces = [plate, ball]
    const world = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 180; i++) world.step(1 / 60)
    world.syncToDocument(doc)
    const y = ball.state.transform.position[1]
    // It fell past the plate (top at y≈1.04) and kept going — a SOLID plate
    // would have parked it on top at y≈1.12. Falling through the bore is the
    // whole point of a real drilled hole.
    expect(y).toBeLessThan(0.9)
    world.dispose()
  })

  it('a ball too FAT for the bore rests on the drilled plate (the hole is real, not a free pass)', () => {
    const doc = emptyDocument()
    doc.ground.sandbox = undefined
    const plate = makePiece('block', [0, 1.0, 0])
    plate.dimensions = { x: 0.6, y: 0.08, z: 0.6 }
    plate.anchored = true
    plate.cuts = [{ id: 'c1', tool: 'bore', radius: 0.06, axis: 'y', offset: [0, 0] }]
    // A ball wider than the Ø0.12 bore — it can't fit through. Released just
    // above the plate so it settles on the rim at low speed (a thin static mesh
    // has no continuous collision, so a high-speed drop would tunnel it).
    const ball = makePiece('ball', [0, 1.2, 0])
    ball.dimensions = { radius: 0.12 }
    doc.pieces = [plate, ball]
    const world = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 180; i++) world.step(1 / 60)
    world.syncToDocument(doc)
    const y = ball.state.transform.position[1]
    // Caught on the bore rim (top at y≈1.04; on-axis a Ø0.24 ball on a Ø0.12
    // bore rests with its centre ≈ 1.04 + √(0.12²−0.06²) ≈ 1.14).
    expect(y).toBeGreaterThan(1.1)
    world.dispose()
  })
})
