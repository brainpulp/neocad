import { it, expect } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { dimensionEntries } from '../../src/render/DimensionLabels'

it('lists editable dimensions per primitive', () => {
  expect(dimensionEntries(makePiece('block', [0, 0, 0])).map((e) => e.key).sort()).toEqual(['x', 'y', 'z'])
  expect(dimensionEntries(makePiece('rod', [0, 0, 0])).map((e) => e.key).sort()).toEqual(['height', 'radius'])
  expect(dimensionEntries(makePiece('ball', [0, 0, 0])).map((e) => e.key)).toEqual(['radius'])
})

it('reports current values', () => {
  const p = makePiece('block', [0, 0, 0])
  const x = dimensionEntries(p).find((e) => e.key === 'x')!
  expect(x.value).toBeCloseTo(0.3)
})
