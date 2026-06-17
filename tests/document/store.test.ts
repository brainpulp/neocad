import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('addPiece appends and undo removes it; redo restores', () => {
  const s = createDocStore()
  s.getState().addPiece(makePiece('block', [0, 1, 0]))
  expect(s.getState().doc.pieces).toHaveLength(1)
  s.getState().undo()
  expect(s.getState().doc.pieces).toHaveLength(0)
  s.getState().redo()
  expect(s.getState().doc.pieces).toHaveLength(1)
})

it('updatePiece changes a field and is undoable', () => {
  const s = createDocStore()
  const p = makePiece('block', [0, 1, 0])
  s.getState().addPiece(p)
  s.getState().updatePiece(p.id, { anchored: true })
  expect(s.getState().doc.pieces[0].anchored).toBe(true)
  s.getState().undo()
  expect(s.getState().doc.pieces[0].anchored).toBe(false)
})

it('a new structural edit clears the redo future', () => {
  const s = createDocStore()
  s.getState().addPiece(makePiece('block', [0, 1, 0]))
  s.getState().undo()
  s.getState().addPiece(makePiece('ball', [0, 1, 0]))
  s.getState().redo() // nothing to redo
  expect(s.getState().doc.pieces).toHaveLength(1)
  expect(s.getState().doc.pieces[0].stockType).toBe('ball')
})
