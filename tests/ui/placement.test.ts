import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { snapToGrid } from '../../src/render/snap'

it('commitHeldAt adds the active-tool stock as a piece and clears the tool', () => {
  const s = createDocStore()
  s.getState().setActiveTool('block')
  s.getState().commitHeldAt([1, 0.5, 0])
  expect(s.getState().doc.pieces).toHaveLength(1)
  expect(s.getState().doc.pieces[0].stockType).toBe('block')
  expect(s.getState().activeTool).toBeNull()
})

it('commitHeldAt is a no-op when no tool is active', () => {
  const s = createDocStore()
  s.getState().commitHeldAt([0, 0, 0])
  expect(s.getState().doc.pieces).toHaveLength(0)
})

it('snapToGrid rounds X/Z to the grid and leaves Y alone', () => {
  expect(snapToGrid([0.13, 1.7, -0.04], 0.1)).toEqual([0.1, 1.7, -0.0])
  expect(snapToGrid([0.16, 2.0, 0.24], 0.1)).toEqual([0.2, 2.0, 0.2])
})
