import { it, expect, beforeAll, describe } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

describe('hollow pieces collide as their real walls', () => {
  it('a ball dropped into an open-top hollow box is contained by the walls', () => {
    const doc = emptyDocument()
    doc.ground.sandbox = undefined
    // A 0.5 m open-top box, anchored, sitting on the ground.
    const box = makePiece('block', [0, 0.25, 0])
    box.dimensions = { x: 0.5, y: 0.5, z: 0.5 }
    box.hollow = { thickness: 0.03, openFace: '+y' }
    box.anchored = true
    // A ball small enough to fit inside, dropped from above the rim.
    const ball = makePiece('ball', [0.05, 0.9, 0.05])
    ball.dimensions = { radius: 0.08 }
    doc.pieces = [box, ball]
    const world = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 240; i++) world.step(1 / 60)
    world.syncToDocument(doc)
    const p = ball.state.transform.position
    // The ball came to rest ON the inner floor (above the 3cm bottom wall,
    // below the rim), NOT on the ground at y≈0.08 (which a missing floor
    // would allow) and NOT resting on a solid top (a non-hollow box).
    expect(p[1]).toBeGreaterThan(0.1) // held up by the inner floor
    expect(p[1]).toBeLessThan(0.5) // still down inside, below the rim
    // Contained laterally within the walls.
    expect(Math.abs(p[0])).toBeLessThan(0.22)
    expect(Math.abs(p[2])).toBeLessThan(0.22)
    world.dispose()
  })

  it('a thin dowel drops straight THROUGH a vertical tube bore', () => {
    const doc = emptyDocument()
    doc.ground.sandbox = undefined
    // Fat vertical tube, anchored, floating so the dowel can fall clear through.
    const tube = makePiece('tube', [0, 1.2, 0])
    tube.dimensions = { radius: 0.2, height: 0.6 }
    tube.hollow = { thickness: 0.03 } // tube: both ends open
    tube.anchored = true
    // A dowel thinner than the bore (bore radius ≈ 0.17), dropped from above.
    const dowel = makePiece('dowel', [0, 1.9, 0])
    dowel.dimensions = { radius: 0.05, height: 0.4 }
    doc.pieces = [tube, dowel]
    const world = new PhysicsWorld(Jolt, doc)
    for (let i = 0; i < 180; i++) world.step(1 / 60)
    world.syncToDocument(doc)
    const y = dowel.state.transform.position[1]
    // It fell past the tube (whose bottom is at y≈0.9) and kept going — a
    // phantom SOLID cylinder would have parked it on top at y≈1.55. Passing
    // through the bore is the whole point; it may tip/drift on the way out.
    expect(y).toBeLessThan(0.85)
    world.dispose()
  })
})
