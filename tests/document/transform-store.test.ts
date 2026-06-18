import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'

it('transformDragging tracks the dragged piece id', () => {
  const s = createDocStore()
  s.getState().setTransformDragging('p_1')
  expect(s.getState().transformDraggingId).toBe('p_1')
  s.getState().setTransformDragging(null)
  expect(s.getState().transformDraggingId).toBeNull()
})

it('grabMode toggles', () => {
  const s = createDocStore()
  expect(s.getState().grabMode).toBe(false)
  s.getState().setGrabMode(true)
  expect(s.getState().grabMode).toBe(true)
})
