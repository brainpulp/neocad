import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { buildExportScene } from '../../src/export/scene'

it('builds one mesh per piece at its state position', async () => {
  const doc = emptyDocument()
  doc.pieces.push(makePiece('block', [1, 0.5, 0]), makePiece('rod', [0, 1, 0]))
  const group = await buildExportScene(doc)
  expect(group.children).toHaveLength(2)
  expect(group.children[0].position.toArray()).toEqual([1, 0.5, 0])
})

it('produces an empty group for an empty document', async () => {
  expect((await buildExportScene(emptyDocument())).children).toHaveLength(0)
})

it('a drilled piece exports the hole-punched mesh (more tris than a plain box)', async () => {
  const doc = emptyDocument()
  const plain = makePiece('block', [0, 0, 0])
  const drilled = makePiece('block', [1, 0, 0])
  drilled.cuts = [{ id: 'c1', tool: 'bore', radius: 0.05, axis: 'y', offset: [0, 0] }]
  doc.pieces.push(plain, drilled)
  const group = await buildExportScene(doc)
  const tris = (m: (typeof group.children)[number]) =>
    ((m as import('three').Mesh).geometry.getAttribute('position') as import('three').BufferAttribute).count
  // The bored block carries the bore-wall facets the plain box never has.
  expect(tris(group.children[1])).toBeGreaterThan(tris(group.children[0]))
})
