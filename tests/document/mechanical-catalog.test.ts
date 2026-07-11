import { it, expect } from 'vitest'
import { STOCK } from '../../src/document/catalog'
import type { StockType } from '../../src/document/types'

const MECHANICAL: StockType[] = ['gear', 'pinion', 'axle', 'pin', 'pulley', 'cam', 'ratchet']

it('mechanical stock is present, grouped, and collides as a cylinder', () => {
  for (const t of MECHANICAL) {
    expect(STOCK[t]).toBeDefined()
    expect(STOCK[t].group).toBe('mechanical')
    expect(STOCK[t].primitive).toBe('cylinder')
    expect(STOCK[t].defaultDimensions.radius).toBeGreaterThan(0)
    expect(STOCK[t].defaultDimensions.height).toBeGreaterThan(0)
  }
})

it('toothed stock carries a teeth dimension for its visual', () => {
  expect(STOCK.gear.defaultDimensions.teeth).toBeGreaterThan(2)
  expect(STOCK.pinion.defaultDimensions.teeth).toBeGreaterThan(2)
  expect(STOCK.ratchet.defaultDimensions.teeth).toBeGreaterThan(2)
  expect(STOCK.cam.defaultDimensions.lobe).toBeGreaterThan(0)
})

it('original stock keeps its group', () => {
  expect(STOCK.rod.group).toBe('stock')
  expect(STOCK.ball.group).toBe('stock')
})
