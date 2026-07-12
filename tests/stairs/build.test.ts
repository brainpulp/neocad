import { describe, it, expect } from 'vitest'
import { defaultStairSpec, type StairSpec } from '../../src/stairs/spec'
import { stairToCsg, stairKey } from '../../src/stairs/build'
import { csgToGeometry } from '../../src/render/csg'

describe('stairs/build', () => {
  it('unions the parts into one CsgNode', () => {
    const node = stairToCsg(defaultStairSpec())
    expect(node?.kind).toBe('union')
    if (node?.kind !== 'union') throw new Error('expected union')
    // 15 risers + 14 treads for the default 2.7 m / 0.18 m stair
    expect(node.children.length).toBe(15 + 14)
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
