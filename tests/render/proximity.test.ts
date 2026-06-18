import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { nearestPiece } from '../../src/render/proximity'

it('finds a piece whose center is within tolerance of a point', () => {
  const doc = emptyDocument()
  const a = makePiece('block', [0, 1, 0])
  const b = makePiece('block', [5, 0, 0])
  doc.pieces.push(a, b)
  expect(nearestPiece(doc, [0, 1.2, 0], 0.5)?.id).toBe(a.id)
  expect(nearestPiece(doc, [9, 9, 9], 0.5)).toBeNull()
})

it('returns the nearest when several are in range', () => {
  const doc = emptyDocument()
  const a = makePiece('block', [0, 0, 0])
  const b = makePiece('block', [0.3, 0, 0])
  doc.pieces.push(a, b)
  expect(nearestPiece(doc, [0.25, 0, 0], 1)?.id).toBe(b.id)
})

it('ignores ids in the exclude set (the piece being placed)', () => {
  const doc = emptyDocument()
  const a = makePiece('block', [0, 1, 0])
  doc.pieces.push(a)
  expect(nearestPiece(doc, [0, 1, 0], 1, new Set([a.id]))).toBeNull()
})
