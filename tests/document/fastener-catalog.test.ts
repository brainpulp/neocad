import { it, expect } from 'vitest'
import { FASTENERS } from '../../src/document/catalog'
import type { FastenerType } from '../../src/document/types'

const RIGID: FastenerType[] = ['weld', 'glue', 'bolt', 'nail']

it('all rigid fasteners are present and map to the fixed constraint', () => {
  for (const t of RIGID) {
    expect(FASTENERS[t]).toBeDefined()
    expect(FASTENERS[t].constraint).toBe('fixed')
  }
})
