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
})
