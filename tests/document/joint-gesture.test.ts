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

  it('joining a piece that is already fastened carries its WHOLE chain rigidly', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 0.15, 0])
    const b = makePiece('block', [1.5, 0.15, 0])
    const c = makePiece('block', [5, 0.15, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().addPiece(c)
    // Weld B onto A (B lands flush at x=0.3).
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(a.id, [0.15, 0.15, 0])
    s.getState().jointClick(b.id, [1.35, 0.15, 0])
    // Now bring B to C: C clicked first (stays), B second (moves) — but B is
    // welded to A, so A must ride along and the weld must stay satisfied.
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(c.id, [4.85, 0.15, 0]) // C's -x face
    s.getState().jointClick(b.id, [0.45, 0.15, 0]) // B's +x face (B now at 0.3)
    const st = s.getState()
    expect(st.doc.fasteners).toHaveLength(2)
    const pa = st.doc.pieces.find((p) => p.id === a.id)!
    const pb = st.doc.pieces.find((p) => p.id === b.id)!
    // B's +x face kisses C's -x face (at 4.85) → B at 4.7; A rode along at B - 0.3.
    expect(pb.state.transform.position[0]).toBeCloseTo(4.7, 3)
    expect(pa.state.transform.position[0]).toBeCloseTo(4.4, 3)
    // The A-B weld gap is unchanged (chain intact, nothing to yank on Run).
    expect(pb.state.transform.position[0] - pa.state.transform.position[0]).toBeCloseTo(0.3, 4)
  })

  it('joining two ALREADY-connected pieces fastens them where they stand (loop closing)', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 0.15, 0])
    const b = makePiece('block', [1.5, 0.15, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(a.id, [0.15, 0.15, 0])
    s.getState().jointClick(b.id, [1.35, 0.15, 0])
    const posAfterFirst = s.getState().doc.pieces.map((p) => [...p.state.transform.position])
    // Second bond between the same two pieces: nothing moves, bond added.
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(a.id, [0, 0.3, 0])
    s.getState().jointClick(b.id, [0.3, 0.3, 0])
    const st = s.getState()
    expect(st.doc.fasteners).toHaveLength(2)
    expect(st.jointNotice).toBeNull()
    st.doc.pieces.forEach((p, i) => {
      expect(p.state.transform.position[0]).toBeCloseTo(posAfterFirst[i][0], 5)
    })
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
