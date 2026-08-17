import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

describe('recovery tools', () => {
  it('resetPieces puts only the given pieces back at their rest placement', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 1, 0])
    const b = makePiece('block', [2, 1, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    // Simulate physics having moved both (state mutates in place).
    a.state.transform.position = [5, 0.15, 5]
    b.state.transform.position = [-4, 0.15, 2]
    const epoch = s.getState().worldEpoch
    s.getState().resetPieces([a.id])
    const st = s.getState()
    expect(st.doc.pieces.find((p) => p.id === a.id)!.state.transform.position).toEqual([0, 1, 0])
    expect(st.doc.pieces.find((p) => p.id === b.id)!.state.transform.position).toEqual([-4, 0.15, 2])
    expect(st.worldEpoch).toBe(epoch + 1) // physics rebuilt
  })

  it('tidy resets only pieces knocked far from their definition', () => {
    const s = createDocStore()
    const settled = makePiece('block', [0, 0.15, 0])
    const flung = makePiece('block', [1, 0.15, 0])
    s.getState().addPiece(settled)
    s.getState().addPiece(flung)
    settled.state.transform.position = [0.02, 0.14, 0.01] // micro-settling: keep
    flung.state.transform.position = [4, 0.15, -3] // scattered: put back
    s.getState().tidy()
    const st = s.getState()
    expect(st.doc.pieces.find((p) => p.id === settled.id)!.state.transform.position[0]).toBeCloseTo(0.02)
    expect(st.doc.pieces.find((p) => p.id === flung.id)!.state.transform.position).toEqual([1, 0.15, 0])
  })

  it('adoptPose makes the current pose the new rest placement (undoable)', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 1, 0])
    s.getState().addPiece(a)
    a.state.transform.position = [2, 0.15, 1]
    s.getState().adoptPose([a.id])
    expect(s.getState().doc.pieces[0].definition.transform.position).toEqual([2, 0.15, 1])
    s.getState().undo()
    expect(s.getState().doc.pieces[0].definition.transform.position).toEqual([0, 1, 0])
  })

  it('duplicatePiece clones dims/material/pose with a fresh id and selects the clone', () => {
    const s = createDocStore()
    const a = makePiece('gear', [1, 0.5, 0])
    a.dimensions.teeth = 24
    s.getState().addPiece(a)
    const clone = s.getState().duplicatePiece(a.id)!
    expect(clone.id).not.toBe(a.id)
    expect(clone.dimensions.teeth).toBe(24)
    expect(clone.state.transform.position).toEqual([1, 0.5, 0])
    expect(s.getState().doc.pieces).toHaveLength(2)
    expect(s.getState().selectedId).toBe(clone.id)
    s.getState().undo()
    expect(s.getState().doc.pieces).toHaveLength(1)
  })

  it('creating a joint hands the tool back to Move', () => {
    const s = createDocStore()
    const a = makePiece('gear', [0.5, 0.2, 0])
    const b = makePiece('axle', [0, 0.3, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().jointClick(a.id, [0.57, 0.2, 0])
    s.getState().jointClick(b.id, [0.015, 0.4, 0])
    expect(s.getState().doc.fasteners).toHaveLength(1)
    expect(s.getState().tool).toBe('transform')
  })
})
