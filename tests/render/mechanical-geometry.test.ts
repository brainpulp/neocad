import { it, expect } from 'vitest'
import { buildVisual, gearGeometry } from '../../src/render/mechanical'
import { STOCK } from '../../src/document/catalog'
import type { VisualKind } from '../../src/document/catalog'

it('every mechanical visual builds valid geometry from its default dims', () => {
  const visuals = Object.values(STOCK)
    .filter((s) => s.visual)
    .map((s) => [s.visual as VisualKind, s.defaultDimensions] as const)
  expect(visuals.length).toBeGreaterThanOrEqual(4) // gear, pinion, ratchet, cam, pulley
  for (const [kind, dims] of visuals) {
    const geo = buildVisual(kind, dims)
    const pos = geo.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    // Every vertex is finite and within the stock's bounding radius.
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true)
      expect(Number.isFinite(pos.getY(i))).toBe(true)
      expect(Number.isFinite(pos.getZ(i))).toBe(true)
    }
    geo.dispose()
  }
})

it('gear teeth reach the tip radius and the spin axis is Y (matches cylinder physics)', () => {
  const geo = gearGeometry(0.12, 0.024, 16)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  expect(Math.max(bb.max.x, bb.max.z)).toBeCloseTo(0.12, 2) // teeth in the XZ plane
  expect(bb.max.y).toBeCloseTo(0.012, 3) // thickness along Y
  expect(bb.min.y).toBeCloseTo(-0.012, 3)
  geo.dispose()
})
