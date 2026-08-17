import { it, expect, describe } from 'vitest'
import { showcaseDocument } from '../../src/document/demoScene'

describe('showcase document', () => {
  it('builds a varied, valid scene with a working hinge', () => {
    const doc = showcaseDocument()
    // A good spread of pieces and the materials library intact.
    expect(doc.pieces.length).toBeGreaterThan(12)
    expect(doc.materials.length).toBeGreaterThan(20)
    // Shows off each capability: metals, glass, magnet, hollow, and a joint.
    const mats = new Set(doc.pieces.map((p) => p.material))
    expect(mats.has('steel')).toBe(true)
    expect(mats.has('glass')).toBe(true)
    expect(mats.has('magnet')).toBe(true)
    expect(doc.pieces.some((p) => p.hollow)).toBe(true)
    expect(doc.fasteners.length).toBeGreaterThanOrEqual(1)
    // The hinge landed (a fastener exists and references two real pieces).
    const f = doc.fasteners[0]
    expect(doc.pieces.find((p) => p.id === f.partA)).toBeDefined()
    expect(doc.pieces.find((p) => p.id === f.partB)).toBeDefined()
  })

  it('every piece has matching definition and state transforms (valid rest pose)', () => {
    const doc = showcaseDocument()
    for (const p of doc.pieces) {
      expect(p.definition.transform.position).toEqual(p.state.transform.position)
    }
  })
})
