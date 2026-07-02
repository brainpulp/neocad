import { makePiece, nextFastenerId } from './catalog'
import type { Fastener, Piece, Quat } from './types'

/**
 * Prebuilt mechanisms: ordinary pieces + joints, dropped into the document as-is.
 * Nothing is special about them afterwards — resize, re-joint, and cannibalize
 * them for other builds. All rest on the workbench slab (top at y=0.05).
 */

export interface MechanismBuild {
  pieces: Piece[]
  fasteners: Fastener[]
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

export const MECHANISMS: { id: string; label: string; icon: string; build: () => MechanismBuild }[] = [
  { id: 'seesaw', label: 'See-saw', icon: '⚖️', build: seeSaw },
  { id: 'pendulum', label: 'Pendulum', icon: '🕰', build: pendulum },
  { id: 'gate', label: 'Swing gate', icon: '🚪', build: gate },
  { id: 'crank-slider', label: 'Crank & slider', icon: '⚙️', build: crankSlider },
]
