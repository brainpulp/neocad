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
