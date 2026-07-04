import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

/**
 * Depenetration on paused edit commits: a move/resize that leaves a piece
 * inside the workbench slab (or under the ground) is swept back up, so Run
 * never starts interpenetrated (pieces used to stay half-sunk in the stage).
 */
describe('clampAboveSlab on edit commits', () => {
  it('movePieceTransform lifts a piece pushed into the slab', () => {
    const s = createDocStore()
    const block = makePiece('block', [0, 0.5, 0]) // 0.3³ box, half-height 0.15
    s.getState().addPiece(block)
    const slabTop = s.getState().doc.ground.sandbox!.thickness
    // Commit a pose with the block's center AT the slab top: half of it sunk.
    s.getState().movePieceTransform(block.id, {
      position: [0, slabTop, 0],
      rotation: [0, 0, 0, 1],
    })
    const p = s.getState().doc.pieces[0]
    // Bottom face rests on the slab, not inside it.
    expect(p.state.transform.position[1]).toBeCloseTo(slabTop + 0.15, 3)
    expect(p.definition.transform.position[1]).toBeCloseTo(slabTop + 0.15, 3)
  })

  it('a resize gesture that grows a piece into the slab is swept up on commit', () => {
    const s = createDocStore()
    const slabTop = s.getState().doc.ground.sandbox!.thickness
    const block = makePiece('block', [0, slabTop + 0.15, 0])
    block.definition.transform.position = [0, slabTop + 0.15, 0]
    block.state.transform.position = [0, slabTop + 0.15, 0]
    s.getState().addPiece(block)
    // Transient resize: height grows 0.3 → 0.6 with the center fixed, so the
    // bottom now reaches below the slab top.
    s.getState().beginTransient()
    s.getState().updatePieceTransient(block.id, {
      dimensions: { ...block.dimensions, y: 0.6 },
    })
    s.getState().endTransient()
    const p = s.getState().doc.pieces[0]
    expect(p.state.transform.position[1]).toBeGreaterThanOrEqual(slabTop + 0.3 - 1e-3)
  })

  it('pieces clear of the slab are untouched', () => {
    const s = createDocStore()
    const block = makePiece('block', [0, 0.5, 0])
    s.getState().addPiece(block)
    s.getState().movePieceTransform(block.id, {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1],
    })
    expect(s.getState().doc.pieces[0].state.transform.position[1]).toBeCloseTo(0.5)
  })

  it('off the bench, the floor is the ground plane (y=0), not the slab top', () => {
    const s = createDocStore()
    const size = s.getState().doc.ground.sandbox!.size
    const block = makePiece('block', [size, 0.5, 0]) // well outside the bench
    s.getState().addPiece(block)
    s.getState().movePieceTransform(block.id, {
      position: [size, -0.05, 0], // sunk below the ground
      rotation: [0, 0, 0, 1],
    })
    expect(s.getState().doc.pieces[0].state.transform.position[1]).toBeCloseTo(0.15, 3)
  })

  it('a piece whose FOOTPRINT overhangs the bench edge rests on the slab, not sunk into it', () => {
    // The "clipping to stage" bug: a wide piece whose CENTER sits just past the
    // bench edge still overhangs the slab. Clamping it to the ground (y=0) buried
    // that overhang inside the raised slab. Footprint overlap must win.
    const s = createDocStore()
    const sb = s.getState().doc.ground.sandbox!
    const edge = sb.size / 2
    // A rod lying on its side (radius 0.6) with its center 0.1 m past the edge:
    // its body spans back well onto the slab, so it must rest ON the slab top.
    const rod = makePiece('rod', [edge + 0.1, 0.5, 0])
    rod.dimensions = { ...rod.dimensions, radius: 0.6, height: 1.2 }
    // Lay it down so its circular cross-section (radius 0.6) is the footprint.
    const lieDown: [number, number, number, number] = [0, 0, 0.7071, 0.7071]
    rod.definition.transform.rotation = lieDown
    rod.state.transform.rotation = lieDown
    s.getState().addPiece(rod)
    s.getState().movePieceTransform(rod.id, {
      position: [edge + 0.1, 0, 0], // sunk to ground level
      rotation: lieDown,
    })
    const p = s.getState().doc.pieces[0]
    // Rests on the slab top (thickness) + its radius, never below the slab surface.
    expect(p.state.transform.position[1]).toBeGreaterThanOrEqual(sb.thickness + 0.6 - 1e-3)
  })
})
