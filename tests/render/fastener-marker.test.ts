import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { fastenerMidpoint } from '../../src/render/FastenerMarker'

it('midpoint is the average of the two pieces positions', () => {
  const a = makePiece('block', [0, 0, 0])
  const b = makePiece('block', [2, 4, 0])
  const doc = emptyDocument()
  doc.pieces.push(a, b)
  expect(fastenerMidpoint(doc, { id: 'f', type: 'weld', partA: a.id, partB: b.id })).toEqual([1, 2, 0])
})

it('returns null when a referenced piece is missing', () => {
  const a = makePiece('block', [0, 0, 0])
  const doc = emptyDocument()
  doc.pieces.push(a)
  expect(fastenerMidpoint(doc, { id: 'f', type: 'weld', partA: a.id, partB: 'ghost' })).toBeNull()
})
