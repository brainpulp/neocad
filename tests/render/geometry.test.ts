import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { pieceVisual } from '../../src/render/geometry'

const materials = emptyDocument().materials

it('maps a joist (box) to box geometry with its full dimensions', () => {
  const p = makePiece('joist', [1, 2, 3])
  const v = pieceVisual(p, materials)
  expect(v.kind).toBe('box')
  expect(v.args).toEqual([p.dimensions.x, p.dimensions.y, p.dimensions.z])
  expect(v.position).toEqual([1, 2, 3])
})

it('maps a rod (cylinder) and ball (sphere) to the right kinds', () => {
  expect(pieceVisual(makePiece('rod', [0, 0, 0]), materials).kind).toBe('cylinder')
  expect(pieceVisual(makePiece('ball', [0, 0, 0]), materials).kind).toBe('sphere')
})

it('resolves color from the materials table', () => {
  const p = makePiece('block', [0, 0, 0]) // default material: wood
  const wood = materials.find((m) => m.name === 'wood')!
  expect(pieceVisual(p, materials).color).toBe(wood.color)
})
