import { makePiece, nextFastenerId } from './catalog'
import type { Fastener, Piece, Quat, Rope } from './types'

/**
 * Prebuilt mechanisms: ordinary pieces + joints, dropped into the document as-is.
 * Nothing is special about them afterwards — resize, re-joint, and cannibalize
 * them for other builds. All rest on the workbench slab (top at y=0.05).
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

const ROT_X90: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]

function seeSaw(): MechanismBuild {
  const fulcrum = makePiece('block', [0, 0.15, 0])
  fulcrum.dimensions = { x: 0.2, y: 0.2, z: 0.2 }
  fulcrum.anchored = true
  fulcrum.name = 'Fulcrum'
  const plank = makePiece('panel', [0, 0.265, 0])
  plank.dimensions = { x: 1.4, y: 0.03, z: 0.25 }
  plank.name = 'Plank'
  return {
    pieces: [fulcrum, plank],
    fasteners: [
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: plank.id,
        partB: fulcrum.id,
        anchorA: [0, -0.015, 0],
        anchorB: [0, 0.1, 0],
        axisA: [0, 0, 1],
      },
    ],
  }
}

function pendulum(): MechanismBuild {
  const post = makePiece('block', [0, 0.65, 0])
  post.dimensions = { x: 0.06, y: 1.2, z: 0.06 }
  post.anchored = true
  post.name = 'Post'
  const arm = makePiece('rod', [0.0, 1.0, 0.06])
  arm.dimensions = { radius: 0.015, height: 0.5 }
  arm.name = 'Pendulum arm'
  const bob = makePiece('ball', [0, 0.75, 0.06])
  bob.dimensions = { radius: 0.07 }
  bob.name = 'Bob'
  return {
    pieces: [post, arm, bob],
    fasteners: [
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: arm.id,
        partB: post.id,
        anchorA: [0, 0.25, 0], // arm top
        anchorB: [0, 0.6, 0.06], // post top, offset to the arm's plane
        axisA: [0, 0, 1],
      },
      { id: nextFastenerId(), type: 'weld', partA: bob.id, partB: arm.id },
    ],
  }
}

function gate(): MechanismBuild {
  const post = makePiece('block', [-0.45, 0.5, 0])
  post.dimensions = { x: 0.08, y: 0.9, z: 0.08 }
  post.anchored = true
  post.name = 'Gate post'
  const leaf = makePiece('panel', [0, 0.5, 0])
  leaf.dimensions = { x: 0.9, y: 0.8, z: 0.03 }
  leaf.name = 'Gate leaf'
  return {
    pieces: [post, leaf],
    fasteners: [
      {
        id: nextFastenerId(),
        type: 'pivot',
        partA: leaf.id,
        partB: post.id,
        anchorA: [-0.45, 0, 0], // leaf's hinge edge
        anchorB: [0, 0, 0], // post center — same world point
        axisA: [0, 1, 0],
      },
    ],
  }
}

/** Crank–slider: a driven crank spins, the connecting rod shoves a carriage. */
function crankSlider(): MechanismBuild {
  const stand = makePiece('block', [-0.35, 0.25, 0])
  stand.dimensions = { x: 0.06, y: 0.4, z: 0.06 }
  stand.anchored = true
  stand.name = 'Crank stand'

  const crank = makePiece('gear', [-0.35, 0.25, 0.05])
  crank.dimensions = { radius: 0.12, height: 0.03, teeth: 16 }
  crank.state.transform.rotation = [...ROT_X90]
  crank.definition.transform.rotation = [...ROT_X90]
  crank.name = 'Crank'

  const rod = makePiece('slat', [-0.1, 0.25, 0.08])
  rod.dimensions = { x: 0.5, y: 0.02, z: 0.04 }
  rod.name = 'Connecting rod'

  const rail = makePiece('joist', [0.3, 0.075, 0])
  rail.dimensions = { x: 1.0, y: 0.05, z: 0.12 }
  rail.anchored = true
  rail.name = 'Rail'

  const carriage = makePiece('block', [0.15, 0.25, 0.08])
  carriage.dimensions = { x: 0.12, y: 0.12, z: 0.12 }
  carriage.name = 'Carriage'

  return {
    pieces: [stand, crank, rod, rail, carriage],
    fasteners: [
      {
        // Driven crank on its stand (motor!).
        id: nextFastenerId(),
        type: 'pivot',
        partA: crank.id,
        partB: stand.id,
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0.05],
        axisA: [0, 1, 0], // gear bore axis (local y → world z after the X-rotation)
        motor: { enabled: true, velocity: 3, maxForce: 60 },
      },
      {
        // Rod's left eye rides the crank rim.
        id: nextFastenerId(),
        type: 'pivot',
        partA: rod.id,
        partB: crank.id,
        anchorA: [-0.25, 0, 0],
        anchorB: [0.1, 0, 0.03], // rim point (crank local; z → world +z toward the rod)
        axisA: [0, 0, 1],
      },
      {
        // Rod's right eye drives the carriage.
        id: nextFastenerId(),
        type: 'pivot',
        partA: rod.id,
        partB: carriage.id,
        anchorA: [0.25, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [0, 0, 1],
      },
      {
        // Carriage slides along the fixed rail.
        id: nextFastenerId(),
        type: 'linear',
        partA: carriage.id,
        partB: rail.id,
        anchorA: [0, 0, 0],
        anchorB: [-0.15, 0.175, 0.08],
        axisA: [1, 0, 0],
        slideMin: -0.35,
        slideMax: 0.35,
      },
    ],
  }
}

/**
 * Four-bar linkage (crank–rocker, movement #97 territory in "507 Mechanical
 * Movements"): a short driven crank spins, the coupler drives a long rocker
 * back and forth. Grashof condition satisfied: 0.15 + 0.5 < 0.3 + 0.461.
 */
function fourBar(): MechanismBuild {
  const base = makePiece('slat', [0, 0.35, 0])
  base.dimensions = { x: 0.5, y: 0.03, z: 0.04 }
  base.anchored = true
  base.name = 'Ground link'

  const crank = makePiece('slat', [-0.175, 0.35, 0.04])
  crank.dimensions = { x: 0.15, y: 0.02, z: 0.03 }
  crank.name = 'Crank'

  const ROT_Z90: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
  const rocker = makePiece('slat', [0.25, 0.5, 0.04])
  rocker.dimensions = { x: 0.3, y: 0.02, z: 0.03 }
  rocker.state.transform.rotation = [...ROT_Z90]
  rocker.definition.transform.rotation = [...ROT_Z90]
  rocker.name = 'Rocker'

  // Coupler spans crank tip (-0.1, 0.35) → rocker tip (0.25, 0.65).
  const theta = Math.atan2(0.3, 0.35)
  const ROT_COUPLER: Quat = [0, 0, Math.sin(theta / 2), Math.cos(theta / 2)]
  const len = Math.hypot(0.35, 0.3)
  const coupler = makePiece('slat', [0.075, 0.5, 0.07])
  coupler.dimensions = { x: len, y: 0.02, z: 0.03 }
  coupler.state.transform.rotation = [...ROT_COUPLER]
  coupler.definition.transform.rotation = [...ROT_COUPLER]
  coupler.name = 'Coupler'

  return {
    pieces: [base, crank, rocker, coupler],
    fasteners: [
      {
        // Driven crank on the left ground pivot.
        id: nextFastenerId(),
        type: 'pivot',
        partA: crank.id,
        partB: base.id,
        anchorA: [-0.075, 0, 0],
        anchorB: [-0.25, 0, 0.04],
        axisA: [0, 0, 1],
        motor: { enabled: true, velocity: 2.5, maxForce: 40 },
      },
      {
        // Rocker on the right ground pivot (its local -x end after the 90° turn).
        id: nextFastenerId(),
        type: 'pivot',
        partA: rocker.id,
        partB: base.id,
        anchorA: [-0.15, 0, 0],
        anchorB: [0.25, 0, 0.04],
        axisA: [0, 0, 1],
      },
      {
        // Coupler left eye on the crank tip.
        id: nextFastenerId(),
        type: 'pivot',
        partA: coupler.id,
        partB: crank.id,
        anchorA: [-len / 2, 0, 0],
        anchorB: [0.075, 0, 0.03],
        axisA: [0, 0, 1],
      },
      {
        // Coupler right eye on the rocker tip.
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
 * Counterweight catapult: a heavy steel block on the short end of a pivoted
 * arm, a loose light ball resting on the long end. Press Run and it fires.
 */
function catapult(): MechanismBuild {
  const post = makePiece('block', [-0.1, 0.16, 0])
  post.dimensions = { x: 0.06, y: 0.22, z: 0.12 }
  post.anchored = true
  post.name = 'Catapult post'

  const arm = makePiece('slat', [0.1, 0.235, 0])
  arm.dimensions = { x: 0.8, y: 0.03, z: 0.08 }
  arm.name = 'Throwing arm'

  const weight = makePiece('block', [-0.24, 0.31, 0])
  weight.dimensions = { x: 0.12, y: 0.12, z: 0.12 }
  weight.material = 'steel'
  weight.name = 'Counterweight'

  const ball = makePiece('ball', [0.45, 0.3, 0])
  ball.dimensions = { radius: 0.05 }
  ball.material = 'cork'
  ball.name = 'Payload'

  return {
    pieces: [post, arm, weight, ball],
    fasteners: [
      {
        // Arm pivots on the post, with end stops so it throws then rests.
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
      { id: nextFastenerId(), type: 'weld', partA: weight.id, partB: arm.id },
      // The payload is deliberately LOOSE — it flies.
    ],
  }
}

/** Playground swing: seat hung from an anchored frame by two real ropes. */
function swing(): MechanismBuild {
  const mkPost = (x: number) => {
    const post = makePiece('block', [x, 0.55, 0])
    post.dimensions = { x: 0.06, y: 1.0, z: 0.06 }
    post.anchored = true
    post.name = 'Swing post'
    return post
  }
  const postL = mkPost(-0.35)
  const postR = mkPost(0.35)
  const bar = makePiece('joist', [0, 1.08, 0])
  bar.dimensions = { x: 0.9, y: 0.06, z: 0.06 }
  bar.anchored = true
  bar.name = 'Crossbar'
  const seat = makePiece('panel', [0, 0.45, 0])
  seat.dimensions = { x: 0.35, y: 0.03, z: 0.18 }
  seat.name = 'Seat'

  const rope = (side: 1 | -1): Rope => ({
    id: nextMechRopeId(),
    name: 'Swing rope',
    start: [side * 0.25, 1.05, 0],
    end: [side * 0.15, 0.465, 0],
    segments: 12,
    radius: 0.008,
    slack: 1.0,
    stiffness: 0.9,
    looped: false,
    attachStart: { pieceId: bar.id, anchor: [side * 0.25, -0.03, 0] },
    attachEnd: { pieceId: seat.id, anchor: [side * 0.15, 0.015, 0] },
    material: 'hemp',
  })

  return {
    pieces: [postL, postR, bar, seat],
    fasteners: [],
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
