import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { addFastener, removeFastener, removePiece } from '../../src/document/document'
import { fromJSON } from '../../src/document/serialize'

it('emptyDocument has an empty fasteners array', () => {
  expect(emptyDocument().fasteners).toEqual([])
})

it('addFastener links two pieces; removeFastener removes it', () => {
  const a = makePiece('joist', [0, 1, 0])
  const b = makePiece('joist', [0, 2, 0])
  let doc = emptyDocument()
  doc.pieces.push(a, b)
  doc = addFastener(doc, { id: 'f1', type: 'weld', partA: a.id, partB: b.id })
  expect(doc.fasteners).toHaveLength(1)
  doc = removeFastener(doc, 'f1')
  expect(doc.fasteners).toHaveLength(0)
})

it('removePiece also drops fasteners that reference it', () => {
  const a = makePiece('joist', [0, 1, 0])
  const b = makePiece('joist', [0, 2, 0])
  let doc = emptyDocument()
  doc.pieces.push(a, b)
  doc = addFastener(doc, { id: 'f1', type: 'bolt', partA: a.id, partB: b.id })
  doc = removePiece(doc, a.id)
  expect(doc.fasteners).toHaveLength(0)
})

it('migrates a fastener-less document by adding fasteners[]', () => {
  const legacy = JSON.stringify({
    version: 1,
    metadata: { name: 'x' },
    materials: [],
    pieces: [],
    ground: { gravity: [0, -9.81, 0] },
  })
  expect(fromJSON(legacy).fasteners).toEqual([])
})
