import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

describe('joining is a paused, predictable gesture', () => {
  it('selecting the joint tool pauses the sim (and it stays paused after)', () => {
    const s = createDocStore()
    expect(s.getState().running).toBe(true)
    s.getState().setTool('joint')
    expect(s.getState().running).toBe(false)
  })

  it('both parts fixed → advisory notice, no fastener, nothing moves', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 0.15, 0])
    a.anchored = true
    const b = makePiece('block', [1, 0.15, 0])
    b.anchored = true
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().jointClick(a.id, [0.15, 0.15, 0])
    s.getState().jointClick(b.id, [0.85, 0.15, 0])
    const st = s.getState()
    expect(st.doc.fasteners).toHaveLength(0)
    expect(st.jointNotice).toMatch(/fixed/i)
    expect(st.jointA).toBeNull()
    // The blocks did not move.
    expect(st.doc.pieces[0].state.transform.position[0]).toBeCloseTo(0)
    expect(st.doc.pieces[1].state.transform.position[0]).toBeCloseTo(1)
  })

  it('WYSIWYG type: the displayed type is applied even after re-entering the tool', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 0.15, 0])
    a.anchored = true
    const b = makePiece('block', [1, 0.15, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    // Pick Hinge explicitly, then leave and re-enter the joint tool: the radio
    // still shows Hinge, so Hinge must be what gets created — the old code
    // silently substituted a suggestion here.
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().setTool('transform')
    s.getState().setTool('joint')
    expect(s.getState().jointType).toBe('pivot')
    s.getState().jointClick(a.id, [0.15, 0.15, 0]) // face pick: suggestion would be weld/linear
    s.getState().jointClick(b.id, [0.85, 0.15, 0])
    const st = s.getState()
    expect(st.doc.fasteners).toHaveLength(1)
    expect(st.doc.fasteners[0].type).toBe(st.jointType)
  })

  it('a successful join clears any advisory and lands the second piece against the first', () => {
    const s = createDocStore()
    const stay = makePiece('block', [0, 0.15, 0])
    stay.anchored = true
    const come = makePiece('block', [1.5, 0.15, 0])
    s.getState().addPiece(stay)
    s.getState().addPiece(come)
    s.getState().setTool('joint')
    s.getState().jointClick(stay.id, [0.15, 0.15, 0]) // +x face of the stayer
    s.getState().jointClick(come.id, [1.35, 0.15, 0]) // -x face of the comer
    const st = s.getState()
    expect(st.jointNotice).toBeNull()
    expect(st.doc.fasteners).toHaveLength(1)
    const moved = st.doc.pieces.find((p) => p.id === come.id)!
    // Lands flush against the stayer's +x face: centers 0.3 apart.
    expect(moved.state.transform.position[0]).toBeCloseTo(0.3, 3)
    expect(st.doc.pieces.find((p) => p.id === stay.id)!.state.transform.position[0]).toBeCloseTo(0)
  })
})
