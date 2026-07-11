import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'

it('addMaterial appends a new material', () => {
  const s = createDocStore()
  s.getState().addMaterial({ name: 'titanium', density: 4500, friction: 0.4, restitution: 0.1, color: '#9aa' })
  expect(s.getState().doc.materials.some((m) => m.name === 'titanium')).toBe(true)
})

it('updateMaterial edits an existing material by name', () => {
  const s = createDocStore()
  s.getState().addMaterial({ name: 'titanium', density: 4500, friction: 0.4, restitution: 0.1, color: '#9aa' })
  s.getState().updateMaterial('titanium', { density: 4506 })
  expect(s.getState().doc.materials.find((m) => m.name === 'titanium')!.density).toBe(4506)
})

it('mergeLibraryMaterials backfills magnetic/optics and appends new library entries', async () => {
  const { mergeLibraryMaterials } = await import('../../src/document/store')
  const { emptyDocument } = await import('../../src/document/types')
  const doc = emptyDocument()
  // Simulate an OLD autosave: strip the new fields, drop the magnet material,
  // and keep a user edit (custom steel density).
  doc.materials = doc.materials
    .filter((m) => m.name !== 'magnet')
    .map((m) => {
      const { magnetic: _m, optics: _o, ...rest } = m
      return m.name === 'steel' ? { ...rest, density: 8000 } : rest
    })
  const merged = mergeLibraryMaterials(doc)
  const steel = merged.materials.find((m) => m.name === 'steel')!
  expect(steel.magnetic).toBe('ferrous')
  expect(steel.density).toBe(8000) // user edit preserved
  expect(merged.materials.find((m) => m.name === 'magnet')?.magnetic).toBe('magnet')
  expect(merged.materials.find((m) => m.name === 'glass')?.optics?.transmission).toBeGreaterThan(0.5)
})
