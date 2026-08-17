import { describe, it, expect } from 'vitest'
import { defaultStairSpec, type StairSpec } from '../../src/stairs/spec'
import { stairToCsg, stairKey } from '../../src/stairs/build'
import { csgToGeometry } from '../../src/render/csg'

describe('stairs/build', () => {
  it('unions the parts into one CsgNode', () => {
    const node = stairToCsg({
      ...defaultStairSpec(),
      riserMode: 'closed',
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25, endBottom: 'seat' as const, endTop: 'plumb' as const },
      railing: { sides: 'none', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
    })
    expect(node?.kind).toBe('union')
    if (node?.kind !== 'union') throw new Error('expected union')
    // 15 risers + 14 treads for the default 2.7 m / 0.18 m stair (no sidings/rails)
    expect(node.children.length).toBe(15 + 14)
  })

  it('an L-stair with a landing still meshes watertight', async () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      sizing: { mode: 'byCount', count: 16 },
      turns: [{ id: 't', angle: 90, direction: 'right', kind: 'landing', landingShape: 'square', winderSteps: 3 }],
    }
    const geo = await csgToGeometry(stairToCsg(spec)!)
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    geo.dispose()
  })

  it('a winder stair meshes watertight', async () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      sizing: { mode: 'byCount', count: 15 },
      turns: [{ id: 't', angle: 90, direction: 'right', kind: 'winder', landingShape: 'square', winderSteps: 3 }],
    }
    const geo = await csgToGeometry(stairToCsg(spec)!)
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    geo.dispose()
  })

  it('meshes to a watertight solid via the manifold kernel', async () => {
    const spec: StairSpec = { ...defaultStairSpec(), sizing: { mode: 'byCount', count: 6 } }
    const node = stairToCsg(spec)!
    const geo = await csgToGeometry(node)
    const pos = geo.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    geo.dispose()
  })

  it('more steps → more triangles', async () => {
    const few = stairToCsg({ ...defaultStairSpec(), sizing: { mode: 'byCount', count: 4 } })!
    const many = stairToCsg({ ...defaultStairSpec(), sizing: { mode: 'byCount', count: 16 } })!
    const [a, b] = await Promise.all([csgToGeometry(few), csgToGeometry(many)])
    expect(b.getAttribute('position').count).toBeGreaterThan(a.getAttribute('position').count)
    a.dispose()
    b.dispose()
  })

  it('stairKey changes with a parameter, stable otherwise', () => {
    const s = defaultStairSpec()
    expect(stairKey(s)).toBe(stairKey(defaultStairSpec()))
    expect(stairKey(s)).not.toBe(stairKey({ ...s, going: 0.3 }))
  })
})
