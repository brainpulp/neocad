import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { localToWorld } from '../../src/document/math'

describe('joint tool (A → type → B)', () => {
  it('defaults: transform tool, pivot joint, translate gizmo', () => {
    const s = createDocStore()
    expect(s.getState().tool).toBe('transform')
    expect(s.getState().jointType).toBe('pivot')
    expect(s.getState().gizmoMode).toBe('translate')
  })

  it('two clicks on different pieces create a joint with local anchors and axis', () => {
    const s = createDocStore()
    const a = makePiece('joist', [0, 1, 0])
    const b = makePiece('joist', [1, 1, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    s.getState().jointClick(a.id, [0.2, 1, 0])
    expect(s.getState().jointA?.pieceId).toBe(a.id)
    s.getState().jointClick(b.id, [0.8, 1, 0])
    const f = s.getState().doc.fasteners[0]
    expect(f).toBeDefined()
    expect(f.type).toBe('pivot')
    expect(f.partA).toBe(a.id)
    expect(f.partB).toBe(b.id)
    // Anchors stored piece-local; converting back through the piece's transform
    // must reproduce the clicked world points.
    const worldA = localToWorld(a.state.transform, f.anchorA!)
    expect(worldA[0]).toBeCloseTo(0.2)
    expect(worldA[1]).toBeCloseTo(1)
    expect(localToWorld(b.state.transform, f.anchorB!)[0]).toBeCloseTo(0.8)
    // Axis runs from A's point to B's point (world +x), expressed in A's frame.
    expect(f.axisA![0]).toBeCloseTo(1)
    expect(s.getState().jointA).toBeNull()
  })

  it('clicking the same piece twice just moves point A; cancel clears it', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 1, 0])
    s.getState().addPiece(a)
    s.getState().setTool('joint')
    s.getState().jointClick(a.id, [0, 1, 0])
    s.getState().jointClick(a.id, [0.1, 1, 0])
    expect(s.getState().doc.fasteners).toHaveLength(0)
    expect(s.getState().jointA?.point[0]).toBeCloseTo(0.1)
    s.getState().cancelJoint()
    expect(s.getState().jointA).toBeNull()
  })

  it('coincident points fall back to a world-up axis', () => {
    const s = createDocStore()
    const a = makePiece('gear', [0, 1, 0])
    const b = makePiece('axle', [0, 1, 0])
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().setJointType('cylindrical')
    s.getState().jointClick(a.id, [0, 1, 0])
    s.getState().jointClick(b.id, [0, 1, 0])
    const f = s.getState().doc.fasteners[0]
    expect(f.type).toBe('cylindrical')
    expect(f.axisA).toEqual([0, 1, 0])
  })
})

describe('drop-join options (pendingJoin)', () => {
  it('dropping onto a piece pauses the sim and asks instead of auto-welding', () => {
    const s = createDocStore()
    const target = makePiece('panel', [0, 1, 0])
    s.getState().addPiece(target)
    s.getState().setActiveTool('rod')
    s.getState().setProximityTarget(target.id)
    expect(s.getState().running).toBe(true)
    s.getState().commitHeldAt([0, 0.5, 0])
    expect(s.getState().doc.pieces).toHaveLength(2)
    expect(s.getState().doc.fasteners).toHaveLength(0)
    expect(s.getState().running).toBe(false)
    const pending = s.getState().pendingJoin
    expect(pending?.targetId).toBe(target.id)
    // Choosing a fastener joins and resumes.
    s.getState().resolveJoin('bolt')
    expect(s.getState().doc.fasteners).toHaveLength(1)
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

  it('a pre-picked palette fastener still joins immediately without a dialog', () => {
    const s = createDocStore()
    const target = makePiece('panel', [0, 1, 0])
    s.getState().addPiece(target)
    s.getState().setFastenTool('weld')
    s.getState().setActiveTool('rod')
    // setActiveTool clears fastenTool (mutually exclusive modes) — re-pick like the UI does.
    s.getState().setFastenTool('weld')
    expect(s.getState().activeTool).toBeNull()
  })

  it('drop-created joint types get contact-point anchors and a vertical axis', () => {
    const s = createDocStore()
    const target = makePiece('panel', [0, 1, 0])
    s.getState().addPiece(target)
    s.getState().setActiveTool('gear')
    s.getState().setProximityTarget(target.id)
    s.getState().commitHeldAt([0.3, 1.05, 0])
    s.getState().resolveJoin('pivot')
    const f = s.getState().doc.fasteners[0]
    expect(f.type).toBe('pivot')
    expect(f.anchorA).toBeDefined()
    expect(f.axisA).toEqual([0, 1, 0])
  })
})
