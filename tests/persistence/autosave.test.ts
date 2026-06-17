import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { saveDoc, loadDoc } from '../../src/persistence/autosave'

it('returns null before anything is saved... then persists and restores the document', async () => {
  const d = emptyDocument()
  d.metadata.name = 'Bridge'
  d.pieces.push(makePiece('joist', [0, 1, 0]))
  await saveDoc(d)
  const restored = await loadDoc()
  expect(restored?.metadata.name).toBe('Bridge')
  expect(restored?.pieces).toHaveLength(1)
  expect(restored).toEqual(d)
})
