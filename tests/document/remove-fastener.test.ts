import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('removeFastener deletes a fastener and is undoable', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0, 1, 0])
  const b = makePiece('joist', [0, 2, 0])
  s.getState().addPiece(a)
  s.getState().addPiece(b)
  s.getState().setFastenTool('weld')
  s.getState().fastenClick(a.id)
  s.getState().fastenClick(b.id)
  const fid = s.getState().doc.fasteners[0].id
  s.getState().removeFastener(fid)
  expect(s.getState().doc.fasteners).toHaveLength(0)
  s.getState().undo()
  expect(s.getState().doc.fasteners).toHaveLength(1)
})
