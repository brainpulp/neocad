import { it, expect } from 'vitest'
import { STOCK, makePiece } from '../../src/document/catalog'
import type { StockType } from '../../src/document/types'

const ALL_STOCK: StockType[] = ['rod', 'tube', 'dowel', 'slat', 'joist', 'panel', 'block', 'ball']

it('all 8 stock types are present and map to a valid primitive', () => {
  for (const t of ALL_STOCK) {
    expect(STOCK[t]).toBeDefined()
    expect(['box', 'cylinder', 'sphere']).toContain(STOCK[t].primitive)
  }
})

it('makePiece(joist) produces a box piece with default dims and wood material', () => {
  const p = makePiece('joist', [0, 1, 0])
  expect(p.stockType).toBe('joist')
  expect(p.material).toBe('wood')
  expect(p.dimensions).toHaveProperty('x')
  expect(p.state.transform.position).toEqual([0, 1, 0])
  // definition and state start identical
  expect(p.definition.transform.position).toEqual([0, 1, 0])
})

it('makePiece assigns unique ids', () => {
  const a = makePiece('block', [0, 0, 0])
  const b = makePiece('block', [0, 0, 0])
  expect(a.id).not.toBe(b.id)
})
