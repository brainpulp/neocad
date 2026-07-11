import { makePiece, nextFastenerId } from './catalog'
import { planJoint } from './joints'
import { snapToFeature } from './features'
import { worldToLocal } from './math'
import { DEFAULT_MATERIALS, CURRENT_VERSION, type Document, type Piece, type Vec3 } from './types'

/**
 * A curated scene that shows off what NeoCad can do at a glance — so "load the
 * app" isn't a blank stage. Groups of pieces demonstrate each capability:
 * PBR metals & glass (R1), magnetism, real bounce, hollow shells, and a hinge.
 * Everything sits on a wider bench, paused, ready to Run.
 */
export function showcaseDocument(): Document {
  const pieces: Piece[] = []
  const fasteners: Document['fasteners'] = []

  const add = (
    stock: Parameters<typeof makePiece>[0],
    pos: Vec3,
    material: string,
    extra?: Partial<Piece>,
  ): Piece => {
    const p = makePiece(stock, pos)
    p.material = material
    if (extra) Object.assign(p, extra)
    p.definition.transform.position = [...pos]
    p.state.transform.position = [...pos]
    pieces.push(p)
    return p
  }

  // ── Polished metals (R1 environment lighting) ──
  add('ball', [-2.4, 0.35, -1.6], 'steel', { dimensions: { radius: 0.22 } })
  add('ball', [-1.7, 0.35, -1.6], 'brass', { dimensions: { radius: 0.22 } })
  add('ball', [-1.0, 0.35, -1.6], 'copper', { dimensions: { radius: 0.22 } })

  // ── See-through optics: glass pane in front of a walnut block, plus ice ──
  add('block', [1.7, 0.25, -1.6], 'walnut', { dimensions: { x: 0.5, y: 0.5, z: 0.5 } })
  const pane = add('panel', [1.7, 0.55, -1.1], 'glass', { anchored: true })
  const upright: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
  pane.dimensions = { x: 1.2, y: 0.02, z: 0.9 }
  pane.definition.transform.rotation = [...upright]
  pane.state.transform.rotation = [...upright]
  add('block', [2.6, 0.2, -1.4], 'ice', { dimensions: { x: 0.35, y: 0.35, z: 0.35 } })

  // ── Magnetism: an anchored magnet bar with steel balls scattered nearby ──
  add('block', [-1.6, 0.5, 0.4], 'magnet', { anchored: true, dimensions: { x: 0.6, y: 0.18, z: 0.18 } })
  add('ball', [-2.3, 0.1, 0.3], 'steel', { dimensions: { radius: 0.08 } })
  add('ball', [-0.9, 0.1, 0.6], 'steel', { dimensions: { radius: 0.08 } })
  add('ball', [-1.5, 0.1, 1.1], 'steel', { dimensions: { radius: 0.07 } })
  add('ball', [-1.0, 0.1, -0.2], 'pine', { dimensions: { radius: 0.08 } }) // wood ignores it

  // ── Real bounce: a soft-rubber ball held up high, ready to Run ──
  add('ball', [0, 1.4, 0.6], 'rubber-soft', { dimensions: { radius: 0.16 } })

  // ── Hollow: an open-top plastic bin and an aluminium tube ──
  add('block', [1.3, 0.25, 0.8], 'plastic', {
    anchored: true,
    dimensions: { x: 0.5, y: 0.5, z: 0.5 },
    hollow: { thickness: 0.03, openFace: '+y' },
  })
  add('tube', [2.4, 0.3, 0.8], 'aluminum', {
    anchored: true,
    dimensions: { radius: 0.18, height: 0.6 },
    hollow: { thickness: 0.03 },
  })

  // ── A hinge: two boards joined at a shared edge (swings on Run) ──
  const postA = add('joist', [0, 0.4, 2.1], 'oak', { anchored: true, dimensions: { x: 0.8, y: 0.08, z: 0.12 } })
  const leaf = add('joist', [0.4, 0.4, 2.1], 'pine', { dimensions: { x: 0.8, y: 0.08, z: 0.12 } })
  const clickA: Vec3 = [0.38, 0.44, 2.1]
  const clickB: Vec3 = [0.02, 0.44, 2.1]
  const featA = snapToFeature(postA, worldToLocal(postA.state.transform, clickA))
  const featB = snapToFeature(leaf, worldToLocal(leaf.state.transform, clickB))
  const plan = planJoint(postA, featA, leaf, featB, 'pivot', nextFastenerId(), {
    clickA: worldToLocal(postA.state.transform, clickA),
    clickB: worldToLocal(leaf.state.transform, clickB),
    allPieces: pieces,
  })
  if (plan.fastener) {
    if (plan.groupMoves) {
      for (const mv of plan.groupMoves) {
        const p = pieces.find((x) => x.id === mv.id)
        if (p) {
          p.definition.transform = structuredClone(mv.transform)
          p.state.transform = structuredClone(mv.transform)
        }
      }
    }
    fasteners.push(plan.fastener)
  }

  return {
    version: CURRENT_VERSION,
    metadata: { name: 'Showcase' },
    materials: structuredClone(DEFAULT_MATERIALS),
    pieces,
    fasteners,
    ropes: [],
    ground: { gravity: [0, -9.81, 0], sandbox: { size: 7, thickness: 0.05 } },
  }
}
