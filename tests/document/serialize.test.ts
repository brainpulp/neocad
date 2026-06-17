import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { toJSON, fromJSON } from '../../src/document/serialize'

it('round-trips a document with a piece', () => {
  const d = emptyDocument()
  d.pieces.push(makePiece('block', [0, 2, 0]))
  expect(fromJSON(toJSON(d))).toEqual(d)
})

it('migrates a versionless document to CURRENT_VERSION', () => {
  const legacy = JSON.stringify({
    pieces: [],
    materials: [],
    ground: { gravity: [0, -9.81, 0] },
    metadata: { name: 'x' },
  })
  expect(fromJSON(legacy).version).toBe(1)
})
