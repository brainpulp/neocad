import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { localToWorld, localDirToWorld } from '../../src/document/math'

describe('joint tool (A → type → B, feature-snapped)', () => {
  it('defaults: transform tool, pivot joint, translate gizmo', () => {
    const s = createDocStore()
    expect(s.getState().tool).toBe('transform')
    expect(s.getState().jointType).toBe('pivot')
    expect(s.getState().gizmoMode).toBe('translate')
  })

  it('gear onto axle: the gear MOVES onto the axle axis and gets a cylindrical joint', () => {
    const s = createDocStore()
    const gear = makePiece('gear', [0.5, 0.2, 0])
    const axle = makePiece('axle', [0, 0.3, 0]) // vertical, height 0.6
    axle.anchored = true
    s.getState().addPiece(gear)
    s.getState().addPiece(axle)
    s.getState().setTool('joint')
    // Click the gear rim (snaps to bore), then the axle side at height 0.4.
    s.getState().jointClick(gear.id, [0.6, 0.2, 0])
    expect(s.getState().jointA?.feature.kind).toBe('bore')
    // Bore pick suggests cylindrical without an explicit choice.
    expect(s.getState().jointType).toBe('cylindrical')
    s.getState().jointClick(axle.id, [0.015, 0.4, 0])
    const st = s.getState()
    const f = st.doc.fasteners[0]
    expect(f.type).toBe('cylindrical')
    expect(f.anchorA).toEqual([0, 0, 0]) // gear bore, gear-local
    // Align-before-constrain: the gear's bore now sits ON the axle centerline.
    const movedGear = st.doc.pieces.find((p) => p.id === gear.id)!
    const boreWorld = localToWorld(movedGear.state.transform, f.anchorA!)
    expect(boreWorld[0]).toBeCloseTo(0) // on the axle's x
    expect(boreWorld[2]).toBeCloseTo(0) // and z
    // The joint axis reproduces the axle's world axis from A-local storage.
    const axisWorld = localDirToWorld(movedGear.state.transform, f.axisA!)
    expect(Math.abs(axisWorld[1])).toBeCloseTo(1)
    expect(st.jointA).toBeNull()
    // Definition matches State for the moved piece (undoable single entry).
    expect(movedGear.definition.transform.position).toEqual(movedGear.state.transform.position)
  })

  it('one undo reverses BOTH the alignment move and the fastener', () => {
    const s = createDocStore()
    const gear = makePiece('gear', [0.5, 0.2, 0])
    const axle = makePiece('axle', [0, 0.3, 0])
    axle.anchored = true
    s.getState().addPiece(gear)
    s.getState().addPiece(axle)
    s.getState().setTool('joint')
    s.getState().jointClick(gear.id, [0.6, 0.2, 0])
    s.getState().jointClick(axle.id, [0.015, 0.4, 0])
    s.getState().undo()
    const st = s.getState()
    expect(st.doc.fasteners).toHaveLength(0)
    expect(st.doc.pieces.find((p) => p.id === gear.id)!.state.transform.position[0]).toBeCloseTo(0.5)
  })

  it('an explicit type pick beats the suggestion', () => {
    const s = createDocStore()
    const gear = makePiece('gear', [0.5, 0.2, 0])
    const axle = makePiece('axle', [0, 0.3, 0])
    s.getState().addPiece(gear)
    s.getState().addPiece(axle)
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(gear.id, [0.6, 0.2, 0])
    expect(s.getState().jointType).toBe('pivot') // not overridden
    s.getState().jointClick(axle.id, [0.015, 0.4, 0])
    expect(s.getState().doc.fasteners[0].type).toBe('pivot')
  })

  it('clicking the same piece twice re-picks point A; cancel clears it', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 1, 0])
    s.getState().addPiece(a)
    s.getState().setTool('joint')
    s.getState().jointClick(a.id, [0.15, 1, 0])
    s.getState().jointClick(a.id, [0, 1.15, 0])
    expect(s.getState().doc.fasteners).toHaveLength(0)
    expect(s.getState().jointA?.pieceId).toBe(a.id)
    s.getState().cancelJoint()
    expect(s.getState().jointA).toBeNull()
  })

  it('hover exposes the snapped feature for the preview marker', () => {
    const s = createDocStore()
    const gear = makePiece('gear', [0, 0.2, 0])
    s.getState().addPiece(gear)
    s.getState().setTool('joint')
    s.getState().jointHoverAt(gear.id, [0.11, 0.2, 0])
    expect(s.getState().jointHover?.feature.kind).toBe('bore')
    s.getState().jointHoverAt(null)
    expect(s.getState().jointHover).toBeNull()
  })
})

describe('drop-join options (pendingJoin)', () => {
  it('dropping onto a piece pauses the sim and asks, with a suggestion', () => {
    const s = createDocStore()
    const target = makePiece('panel', [0, 1, 0])
    s.getState().addPiece(target)
    s.getState().setActiveTool('rod')
    s.getState().setProximityTarget(target.id)
    expect(s.getState().running).toBe(true)
    s.getState().commitHeldAt([0, 1.05, 0])
    expect(s.getState().doc.pieces).toHaveLength(2)
    expect(s.getState().doc.fasteners).toHaveLength(0)
    expect(s.getState().running).toBe(false)
    const pending = s.getState().pendingJoin
    expect(pending?.targetId).toBe(target.id)
    expect(pending?.suggested).toBeDefined()
    s.getState().resolveJoin('bolt')
    expect(s.getState().doc.fasteners[0].type).toBe('bolt')
    expect(s.getState().pendingJoin).toBeNull()
    expect(s.getState().running).toBe(true)
  })

  it('resolveJoin(null) declines the join and restores the paused state', () => {
    const s = createDocStore()
    const target = makePiece('panel', [0, 1, 0])
    s.getState().addPiece(target)
    s.getState().setRunning(false)
    s.getState().setActiveTool('block')
    s.getState().setProximityTarget(target.id)
    s.getState().commitHeldAt([0, 0.5, 0])
    s.getState().resolveJoin(null)
    expect(s.getState().doc.fasteners).toHaveLength(0)
    expect(s.getState().running).toBe(false) // was paused before the drop
  })

  it('dropping a gear onto an axle suggests cylindrical and joins on the axle axis', () => {
    const s = createDocStore()
    const axle = makePiece('axle', [0, 0.3, 0])
    axle.anchored = true
    s.getState().addPiece(axle)
    s.getState().setActiveTool('gear')
    s.getState().setProximityTarget(axle.id)
    s.getState().commitHeldAt([0.01, 0.45, 0])
    expect(s.getState().pendingJoin?.suggested).toBe('cylindrical')
    s.getState().resolveJoin('cylindrical')
    const st = s.getState()
    const f = st.doc.fasteners[0]
    expect(f.type).toBe('cylindrical')
    // The dropped gear was pulled onto the axle centerline.
    const gearPiece = st.doc.pieces.find((p) => p.id === f.partA)!
    const boreWorld = localToWorld(gearPiece.state.transform, f.anchorA!)
    expect(boreWorld[0]).toBeCloseTo(0)
    expect(boreWorld[2]).toBeCloseTo(0)
  })
})

describe('transient edits (slider gestures)', () => {
  it('a whole gesture is one undo entry', () => {
    const s = createDocStore()
    const block = makePiece('block', [0, 1, 0])
    s.getState().addPiece(block)
    const pastBefore = s.getState().past.length
    s.getState().beginTransient()
    for (const v of [0.35, 0.4, 0.45, 0.5])
      s.getState().updatePieceTransient(block.id, { dimensions: { ...block.dimensions, x: v } })
    s.getState().endTransient()
    expect(s.getState().doc.pieces[0].dimensions.x).toBe(0.5)
    expect(s.getState().past.length).toBe(pastBefore + 1)
    s.getState().undo()
    expect(s.getState().doc.pieces[0].dimensions.x).toBe(0.3) // back to pre-gesture
  })

  it('endTransient without begin is a no-op', () => {
    const s = createDocStore()
    const pastBefore = s.getState().past.length
    s.getState().endTransient()
    expect(s.getState().past.length).toBe(pastBefore)
  })
})
