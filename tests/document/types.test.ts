import { it, expect } from 'vitest'
import { emptyDocument, CURRENT_VERSION } from '../../src/document/types'

it('emptyDocument has version, empty pieces, default ground+materials', () => {
  const d = emptyDocument()
  expect(d.version).toBe(CURRENT_VERSION)
  expect(d.pieces).toEqual([])
  expect(d.materials.length).toBeGreaterThan(0)
  expect(d.ground.gravity).toEqual([0, -9.81, 0])
})
