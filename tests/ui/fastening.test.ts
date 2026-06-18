import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('explicit A→B clicks create a fastener of the active type and clear pending-A', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0, 1, 0])
  const b = makePiece('joist', [0, 2, 0])
  s.getState().addPiece(a)
  s.getState().addPiece(b)
  s.getState().setFastenTool('bolt')
  s.getState().fastenClick(a.id)
  expect(s.getState().pendingFastenA).toBe(a.id)
  s.getState().fastenClick(b.id)
  expect(s.getState().doc.fasteners).toHaveLength(1)
  expect(s.getState().doc.fasteners[0].type).toBe('bolt')
  expect(s.getState().pendingFastenA).toBeNull()
})

it('fastenClick on the same piece twice is ignored', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0, 1, 0])
  s.getState().addPiece(a)
  s.getState().setFastenTool('weld')
  s.getState().fastenClick(a.id)
  s.getState().fastenClick(a.id)
  expect(s.getState().doc.fasteners).toHaveLength(0)
  expect(s.getState().pendingFastenA).toBe(a.id)
})

it('selecting a fasten tool clears the stock tool and vice-versa', () => {
  const s = createDocStore()
  s.getState().setActiveTool('rod')
  s.getState().setFastenTool('weld')
  expect(s.getState().activeTool).toBeNull()
  s.getState().setActiveTool('block')
  expect(s.getState().fastenTool).toBeNull()
})

it('commitHeldAt with a proximity target also welds the new piece to that target', () => {
  const s = createDocStore()
  const top = makePiece('panel', [0, 1, 0])
  s.getState().addPiece(top)
  s.getState().setActiveTool('rod')
  s.getState().setProximityTarget(top.id)
  s.getState().commitHeldAt([0, 0.5, 0])
  expect(s.getState().doc.pieces).toHaveLength(2)
  expect(s.getState().doc.fasteners).toHaveLength(1)
  expect(s.getState().doc.fasteners[0].type).toBe('weld') // default join
  expect(s.getState().proximityTarget).toBeNull()
})
