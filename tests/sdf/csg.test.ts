import { describe, it, expect } from 'vitest'
import type { BufferGeometry } from 'three'
import {
  csgBox,
  csgCylinder,
  csgSphere,
  csgSubtract,
  csgToGeometry,
  csgTransform,
  csgUnion,
} from '../../src/sdf/csg'

/** Edge topology of an indexed geometry: a closed 2-manifold has every edge
 * shared by exactly two triangles (0 boundary, 0 non-manifold). */
function topology(geo: BufferGeometry) {
  const pos = geo.attributes.position.array as ArrayLike<number>
  const idx = geo.index!.array as ArrayLike<number>
  const edges = new Map<string, number>()
  const add = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    edges.set(k, (edges.get(k) ?? 0) + 1)
  }
  for (let i = 0; i < idx.length; i += 3) {
    add(idx[i], idx[i + 1])
    add(idx[i + 1], idx[i + 2])
    add(idx[i + 2], idx[i])
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of edges.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3)
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], pos[i + a])
      mx[a] = Math.max(mx[a], pos[i + a])
    }
  return { tris: idx.length / 3, boundary, nonManifold, size: mn.map((v, i) => mx[i] - v) }
}

describe('csg (manifold exact booleans)', () => {
  it('drilled block: watertight, sharp, low-poly', async () => {
    const g = await csgToGeometry(csgSubtract(csgBox([2, 2, 2]), csgCylinder(0.5, 4)))
    const t = topology(g)
    expect(t.boundary).toBe(0) // no cracks / T-junctions
    expect(t.nonManifold).toBe(0) // 2-manifold
    expect(t.tris).toBeLessThan(1000) // exact CSG stays low-poly (surface nets was ~10k+)
    t.size.forEach((s) => expect(s).toBeCloseTo(2, 3)) // outer 2×2×2 preserved, sharp
  }, 20000)

  it('union + translate compose into a watertight solid', async () => {
    const g = await csgToGeometry(
      csgUnion(csgBox([1, 1, 1]), csgTransform(csgSphere(0.7), { translate: [0.6, 0, 0] })),
    )
    const t = topology(g)
    expect(t.boundary).toBe(0)
    expect(t.nonManifold).toBe(0)
  }, 20000)
})
