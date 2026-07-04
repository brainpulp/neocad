import { it, expect, beforeAll, describe } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { PhysicsWorld } from '../../src/physics/integration'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'

let Jolt: JoltModule

beforeAll(async () => {
  Jolt = await initJolt()
})

/** Drop a ball of `material` from 1.2 m; return the peak height after the first bounce. */
function bouncePeak(material: string): number {
  const doc = emptyDocument()
  const ball = makePiece('ball', [0, 1.2, 0])
  ball.material = material
  doc.pieces = [ball]
  const world = new PhysicsWorld(Jolt, doc)
  let peak = 0
  let falling = true
  for (let i = 0; i < 240; i++) {
    world.step(1 / 60)
    world.syncToDocument(doc)
    const y = ball.state.transform.position[1]
    if (falling && y < 0.25) falling = false // first floor hit approached
    if (!falling) peak = Math.max(peak, y)
  }
  world.dispose()
  return peak
}

describe('material feel: bounce and slide are REAL now', () => {
  it('a soft-rubber ball bounces high; a steel ball thuds', () => {
    const rubber = bouncePeak('rubber-soft') // restitution 0.85
    const steel = bouncePeak('steel') // restitution 0.1
    expect(rubber).toBeGreaterThan(0.55) // more than half the drop height back
    expect(steel).toBeLessThan(0.3)
    expect(rubber).toBeGreaterThan(steel * 2)
  })

  it('an ice block slides much farther than a rubber block', () => {
    const slide = (material: string) => {
      const doc = emptyDocument()
      doc.ground.sandbox = undefined // flat ground, no bench walls
      const block = makePiece('block', [0, 0.16, 0])
      block.material = material
      doc.pieces = [block]
      const world = new PhysicsWorld(Jolt, doc)
      world.setPieceVelocity(block.id, [3, 0, 0])
      for (let i = 0; i < 180; i++) world.step(1 / 60)
      world.syncToDocument(doc)
      world.dispose()
      return block.state.transform.position[0]
    }
    const ice = slide('ice') // friction 0.03
    const rubber = slide('rubber') // friction 0.9
    expect(ice).toBeGreaterThan(rubber + 0.5)
  })
})

describe('magnetism', () => {
  it('a magnet pulls a steel ball in; a wooden ball ignores it', () => {
    const attract = (material: string) => {
      const doc = emptyDocument()
      const magnet = makePiece('block', [0, 0.15, 0])
      magnet.material = 'magnet'
      magnet.anchored = true
      const ball = makePiece('ball', [0.8, 0.15, 0])
      ball.material = material
      doc.pieces = [magnet, ball]
      const world = new PhysicsWorld(Jolt, doc)
      for (let i = 0; i < 120; i++) world.step(1 / 60) // 2 s
      world.syncToDocument(doc)
      world.dispose()
      return ball.state.transform.position[0]
    }
    const steel = attract('steel')
    const pine = attract('pine')
    expect(steel).toBeLessThan(0.45) // moved well toward the magnet
    expect(pine).toBeGreaterThan(0.7) // did not move meaningfully
  })

  it('two magnets attract head-to-tail and REPEL when one is flipped', () => {
    const pair = (flip: boolean) => {
      const doc = emptyDocument()
      doc.ground.sandbox = undefined
      // Float the rods (zero g): pure magnetics, no ground friction masking it.
      doc.ground.gravity = [0, 0, 0]
      // Two magnet rods lying co-axially along x (pole = local y, rotated onto x).
      const r2 = Math.SQRT1_2
      const mk = (id: string, x: number, sign: 1 | -1) => {
        const rod = makePiece('rod', [x, 0.06, 0])
        rod.id = id
        rod.material = 'magnet'
        rod.dimensions = { radius: 0.05, height: 0.3 }
        // Rotate local +y onto ±x: ∓90° about z.
        rod.state.transform.rotation = [0, 0, -sign * r2, r2]
        rod.definition.transform.rotation = [...rod.state.transform.rotation]
        return rod
      }
      const a = mk('a', -0.4, 1)
      const b = mk('b', 0.4, flip ? -1 : 1)
      doc.pieces = [a, b]
      const world = new PhysicsWorld(Jolt, doc)
      for (let i = 0; i < 90; i++) world.step(1 / 60)
      world.syncToDocument(doc)
      world.dispose()
      return Math.abs(b.state.transform.position[0] - a.state.transform.position[0])
    }
    const aligned = pair(false) // head-to-tail → attract
    const flipped = pair(true) // opposed poles → repel
    expect(aligned).toBeLessThan(0.75)
    expect(flipped).toBeGreaterThan(0.85)
    expect(flipped).toBeGreaterThan(aligned + 0.15)
  })
})
