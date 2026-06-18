import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('select sets selectedId; clearing sets it null', () => {
  const s = createDocStore()
  const p = makePiece('block', [0, 1, 0])
  s.getState().addPiece(p)
  s.getState().select(p.id)
  expect(s.getState().selectedId).toBe(p.id)
  s.getState().select(null)
  expect(s.getState().selectedId).toBeNull()
})

it('removing the selected piece clears selectedId', () => {
  const s = createDocStore()
  const p = makePiece('block', [0, 1, 0])
  s.getState().addPiece(p)
  s.getState().select(p.id)
  s.getState().removePiece(p.id)
  expect(s.getState().selectedId).toBeNull()
})
