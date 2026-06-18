import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { buildExportScene } from '../../src/export/scene'

it('builds one mesh per piece at its state position', () => {
  const doc = emptyDocument()
  doc.pieces.push(makePiece('block', [1, 0.5, 0]), makePiece('rod', [0, 1, 0]))
  const group = buildExportScene(doc)
  expect(group.children).toHaveLength(2)
  expect(group.children[0].position.toArray()).toEqual([1, 0.5, 0])
})

it('produces an empty group for an empty document', () => {
  expect(buildExportScene(emptyDocument()).children).toHaveLength(0)
})
