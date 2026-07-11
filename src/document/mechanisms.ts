import { makePiece, nextFastenerId } from './catalog'
import type { Fastener, Piece, Quat, Rope } from './types'

/**
 * Prebuilt mechanisms: ordinary pieces + joints, dropped into the document as-is.
 * Nothing is special about them afterwards — resize, re-joint, and cannibalize
 * them for other builds.
 *
 * DESIGN RULE: a mechanism is NEVER anchored to the world. Every one is a
 * self-contained assembly welded to a heavy BASE PLATE that simply rests on the
 * bench — its wide footprint + mass + ground friction keep it standing. Only the
 * USER makes something stationary (the Fix pin). Builds are authored around the
 * origin at bench height; `insertMechanism` translates the whole thing to where
 * the user drops it.
 */

export interface MechanismBuild {
  pieces: Piece[]
  fasteners: Fastener[]
  ropes?: Rope[]
}

let mechRopeCounter = 0
function nextMechRopeId(): string {
  mechRopeCounter += 1
  return `mrope_${mechRopeCounter}`
}

const SLAB_TOP = 0.05
const ROT_X90: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]

function weld(a: Piece, b: Piece): Fastener {
  return { id: nextFastenerId(), type: 'weld', partA: a.id, partB: b.id }
}

/** A dense, wide base plate resting on the slab — the mechanism's stable foot. */
function basePlate(sizeX: number, sizeZ: number, name = 'Base'): Piece {
  const thick = 0.04
  const plate = makePiece('panel', [0, SLAB_TOP + thick / 2, 0])
  plate.dimensions = { x: sizeX, y: thick, z: sizeZ }
  plate.material = 'concrete'
  plate.name = name
  return plate
}

function seeSaw(): MechanismBuild {
  const base = basePlate(0.5, 0.4)
  const fulcrum = makePiece('block', [0, SLAB_TOP + 0.11, 0])
  fulcrum.dimensions = { x: 0.16, y: 0.14, z: 0.3 }
  fulcrum.material = 'oak'
  fulcrum.name = 'Fulcrum'
  const plank = makePiece('panel', [0, SLAB_TOP + 0.19, 0])
  plank.dimensions = { x: 1.4, y: 0.03, z: 0.25 }
  plank.name = 'Plank'
  return {
    pieces: [base, fulcrum, plank],
    fasteners: [
      weld(fulcrum, base),
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: plank.id,
        partB: fulcrum.id,
        anchorA: [0, -0.015, 0],
        anchorB: [0, 0.07, 0],
        axisA: [0, 0, 1],
      },
    ],
  }
}

function pendulum(): MechanismBuild {
  const base = basePlate(0.4, 0.4)
  const post = makePiece('block', [0, SLAB_TOP + 0.62, 0])
  post.dimensions = { x: 0.06, y: 1.2, z: 0.06 }
  post.material = 'oak'
  post.name = 'Post'
  const arm = makePiece('rod', [0, SLAB_TOP + 0.97, 0.06])
  arm.dimensions = { radius: 0.015, height: 0.5 }
  arm.name = 'Pendulum arm'
  const bob = makePiece('ball', [0, SLAB_TOP + 0.72, 0.06])
  bob.dimensions = { radius: 0.07 }
  bob.material = 'steel'
  bob.name = 'Bob'
  return {
    pieces: [base, post, arm, bob],
    fasteners: [
      weld(post, base),
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: arm.id,
        partB: post.id,
        anchorA: [0, 0.25, 0],
        anchorB: [0, 0.6, 0.06],
        axisA: [0, 0, 1],
      },
      weld(bob, arm),
    ],
  }
}

/**
 * Swing gate: two posts standing on a base, and a rectangular gate leaf hinged
 * to the LEFT post that swings in the gap between them. Reads as a garden gate.
 */
function gate(): MechanismBuild {
  const base = basePlate(1.1, 0.3)
  const mkPost = (x: number, name: string) => {
    const post = makePiece('block', [x, SLAB_TOP + 0.45, 0])
    post.dimensions = { x: 0.08, y: 0.9, z: 0.08 }
    post.material = 'oak'
    post.name = name
    return post
  }
  const hingePost = mkPost(-0.5, 'Hinge post')
  const latchPost = mkPost(0.5, 'Latch post')
  // Leaf a touch shorter than the 0.92 gap between post inner faces so it swings.
  const leaf = makePiece('panel', [0.02, SLAB_TOP + 0.42, 0])
  leaf.dimensions = { x: 0.86, y: 0.7, z: 0.04 }
  leaf.material = 'pine'
  leaf.name = 'Gate leaf'
  return {
    pieces: [base, hingePost, latchPost, leaf],
    fasteners: [
      weld(hingePost, base),
      weld(latchPost, base),
      {
        // Hinge the leaf's left edge to the hinge post; swing about vertical.
        id: nextFastenerId(),
        type: 'pivot',
        partA: leaf.id,
        partB: hingePost.id,
        anchorA: [-0.43, 0, 0],
        anchorB: [0.04, -0.03, 0],
        axisA: [0, 1, 0],
        angleMin: -Math.PI / 2,
        angleMax: Math.PI / 2,
      },
    ],
  }
}

/** Crank–slider: a driven crank spins, the connecting rod shoves a carriage. */
function crankSlider(): MechanismBuild {
  const base = basePlate(1.3, 0.5)

  const stand = makePiece('block', [-0.35, SLAB_TOP + 0.22, 0])
  stand.dimensions = { x: 0.06, y: 0.4, z: 0.06 }
  stand.material = 'oak'
  stand.name = 'Crank stand'

  const crank = makePiece('gear', [-0.35, SLAB_TOP + 0.22, 0.05])
  crank.dimensions = { radius: 0.12, height: 0.03, teeth: 16 }
  crank.state.transform.rotation = [...ROT_X90]
  crank.definition.transform.rotation = [...ROT_X90]
  crank.name = 'Crank'

  const rod = makePiece('slat', [-0.1, SLAB_TOP + 0.22, 0.08])
  rod.dimensions = { x: 0.5, y: 0.02, z: 0.04 }
  rod.name = 'Connecting rod'

  const rail = makePiece('joist', [0.3, SLAB_TOP + 0.05, 0])
  rail.dimensions = { x: 1.0, y: 0.05, z: 0.12 }
  rail.material = 'oak'
  rail.name = 'Rail'

  const carriage = makePiece('block', [0.15, SLAB_TOP + 0.22, 0.08])
  carriage.dimensions = { x: 0.12, y: 0.12, z: 0.12 }
  carriage.name = 'Carriage'

  return {
    pieces: [base, stand, crank, rod, rail, carriage],
    fasteners: [
      weld(stand, base),
      weld(rail, base),
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: crank.id,
        partB: stand.id,
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0.05],
        axisA: [0, 1, 0],
        motor: { enabled: true, velocity: 3, maxForce: 60 },
      },
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: rod.id,
        partB: crank.id,
        anchorA: [-0.25, 0, 0],
        anchorB: [0.1, 0, 0.03],
        axisA: [0, 0, 1],
      },
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: rod.id,
        partB: carriage.id,
        anchorA: [0.25, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [0, 0, 1],
      },
      {
        id: nextFastenerId(),
        type: 'linear',
        partA: carriage.id,
        partB: rail.id,
        anchorA: [0, 0, 0],
        anchorB: [-0.15, 0.145, 0.08],
        axisA: [1, 0, 0],
        slideMin: -0.35,
        slideMax: 0.35,
      },
    ],
  }
}

/**
 * Four-bar linkage (crank–rocker): a short driven crank spins, the coupler
 * drives a long rocker back and forth. The ground link rests on a base plate.
 */
function fourBar(): MechanismBuild {
  const base = basePlate(0.7, 0.35)
  const groundY = SLAB_TOP + 0.35

  const ground = makePiece('slat', [0, groundY, 0])
  ground.dimensions = { x: 0.5, y: 0.03, z: 0.04 }
  ground.material = 'oak'
  ground.name = 'Ground link'
  // Two little standoffs tie the ground link up to its pivots' height.
  const mkLeg = (x: number) => {
    const leg = makePiece('block', [x, SLAB_TOP + 0.17, 0])
    leg.dimensions = { x: 0.04, y: 0.3, z: 0.04 }
    leg.material = 'oak'
    leg.name = 'Leg'
    return leg
  }
  const legL = mkLeg(-0.25)
  const legR = mkLeg(0.25)

  const crank = makePiece('slat', [-0.175, groundY, 0.04])
  crank.dimensions = { x: 0.15, y: 0.02, z: 0.03 }
  crank.name = 'Crank'

  const ROT_Z90: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
  const rocker = makePiece('slat', [0.25, groundY + 0.15, 0.04])
  rocker.dimensions = { x: 0.3, y: 0.02, z: 0.03 }
  rocker.state.transform.rotation = [...ROT_Z90]
  rocker.definition.transform.rotation = [...ROT_Z90]
  rocker.name = 'Rocker'

  const theta = Math.atan2(0.3, 0.35)
  const ROT_COUPLER: Quat = [0, 0, Math.sin(theta / 2), Math.cos(theta / 2)]
  const len = Math.hypot(0.35, 0.3)
  const coupler = makePiece('slat', [0.075, groundY + 0.15, 0.07])
  coupler.dimensions = { x: len, y: 0.02, z: 0.03 }
  coupler.state.transform.rotation = [...ROT_COUPLER]
  coupler.definition.transform.rotation = [...ROT_COUPLER]
  coupler.name = 'Coupler'

  return {
    pieces: [base, legL, legR, ground, crank, rocker, coupler],
    fasteners: [
      weld(legL, base),
      weld(legR, base),
      weld(ground, legL),
      weld(ground, legR),
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: crank.id,
        partB: ground.id,
        anchorA: [-0.075, 0, 0],
        anchorB: [-0.25, 0, 0.04],
        axisA: [0, 0, 1],
        motor: { enabled: true, velocity: 2.5, maxForce: 40 },
      },
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: rocker.id,
        partB: ground.id,
        anchorA: [-0.15, 0, 0],
        anchorB: [0.25, 0, 0.04],
        axisA: [0, 0, 1],
      },
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: coupler.id,
        partB: crank.id,
        anchorA: [-len / 2, 0, 0],
        anchorB: [0.075, 0, 0.03],
        axisA: [0, 0, 1],
      },
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: coupler.id,
        partB: rocker.id,
        anchorA: [len / 2, 0, 0],
        anchorB: [0.15, 0, 0.03],
        axisA: [0, 0, 1],
      },
    ],
  }
}

/**
 * Counterweight catapult: a heavy steel block on the short end of a pivoted arm,
 * a loose light ball on the long end. Press Run and it fires.
 */
function catapult(): MechanismBuild {
  const base = basePlate(0.6, 0.4)
  const post = makePiece('block', [-0.1, SLAB_TOP + 0.13, 0])
  post.dimensions = { x: 0.06, y: 0.22, z: 0.12 }
  post.material = 'oak'
  post.name = 'Catapult post'

  const arm = makePiece('slat', [0.1, SLAB_TOP + 0.205, 0])
  arm.dimensions = { x: 0.8, y: 0.03, z: 0.08 }
  arm.name = 'Throwing arm'

  const weight = makePiece('block', [-0.24, SLAB_TOP + 0.28, 0])
  weight.dimensions = { x: 0.12, y: 0.12, z: 0.12 }
  weight.material = 'steel'
  weight.name = 'Counterweight'

  const ball = makePiece('ball', [0.45, SLAB_TOP + 0.27, 0])
  ball.dimensions = { radius: 0.05 }
  ball.material = 'cork'
  ball.name = 'Payload'

  return {
    pieces: [base, post, arm, weight, ball],
    fasteners: [
      weld(post, base),
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: arm.id,
        partB: post.id,
        anchorA: [-0.2, 0, 0],
        anchorB: [0, 0.075, 0],
        axisA: [0, 0, 1],
        angleMin: -0.35,
        angleMax: 1.1,
      },
      weld(weight, arm),
      // The payload is deliberately LOOSE — it flies.
    ],
  }
}

/** Playground swing: seat hung from a base-mounted frame by two real ropes. */
function swing(): MechanismBuild {
  const base = basePlate(1.0, 0.5)
  const mkPost = (x: number) => {
    const post = makePiece('block', [x, SLAB_TOP + 0.5, 0])
    post.dimensions = { x: 0.06, y: 1.0, z: 0.06 }
    post.material = 'oak'
    post.name = 'Swing post'
    return post
  }
  const postL = mkPost(-0.35)
  const postR = mkPost(0.35)
  const bar = makePiece('joist', [0, SLAB_TOP + 1.02, 0])
  bar.dimensions = { x: 0.9, y: 0.06, z: 0.06 }
  bar.material = 'oak'
  bar.name = 'Crossbar'
  const seat = makePiece('panel', [0, SLAB_TOP + 0.4, 0])
  seat.dimensions = { x: 0.35, y: 0.03, z: 0.18 }
  seat.name = 'Seat'

  const rope = (side: 1 | -1): Rope => ({
    id: nextMechRopeId(),
    name: 'Swing rope',
    start: [side * 0.25, SLAB_TOP + 0.99, 0],
    end: [side * 0.15, SLAB_TOP + 0.415, 0],
    segments: 12,
    radius: 0.008,
    slack: 1.0,
    stiffness: 1,
    elasticity: 0,
    looped: false,
    attachStart: { pieceId: bar.id, anchor: [side * 0.25, -0.03, 0] },
    attachEnd: { pieceId: seat.id, anchor: [side * 0.15, 0.015, 0] },
    material: 'hemp',
  })

  return {
    pieces: [base, postL, postR, bar, seat],
    fasteners: [weld(postL, base), weld(postR, base), weld(bar, postL), weld(bar, postR)],
    ropes: [rope(1), rope(-1)],
  }
}

export const MECHANISMS: { id: string; label: string; icon: string; build: () => MechanismBuild }[] = [
  { id: 'seesaw', label: 'See-saw', icon: '⚖️', build: seeSaw },
  { id: 'pendulum', label: 'Pendulum', icon: '🕰', build: pendulum },
  { id: 'gate', label: 'Swing gate', icon: '🚪', build: gate },
  { id: 'crank-slider', label: 'Crank & slider', icon: '⚙️', build: crankSlider },
  { id: 'four-bar', label: 'Four-bar linkage', icon: '🔗', build: fourBar },
  { id: 'catapult', label: 'Catapult', icon: '🏹', build: catapult },
  { id: 'swing', label: 'Rope swing', icon: '🛝', build: swing },
]

/** Bounding footprint (world XZ half-extents) + top height of a built mechanism. */
export function mechanismBounds(build: MechanismBuild): { hx: number; hz: number; top: number } {
  let hx = 0.2
  let hz = 0.2
  let top = 0.3
  for (const p of build.pieces) {
    const d = p.dimensions
    const ex = (d.x ?? (d.radius ?? 0.1) * 2) / 2
    const ez = (d.z ?? (d.radius ?? 0.1) * 2) / 2
    const ey = (d.y ?? d.height ?? (d.radius ?? 0.1) * 2) / 2
    const [px, py, pz] = p.state.transform.position
    hx = Math.max(hx, Math.abs(px) + ex)
    hz = Math.max(hz, Math.abs(pz) + ez)
    top = Math.max(top, py + ey)
  }
  return { hx, hz, top }
}
