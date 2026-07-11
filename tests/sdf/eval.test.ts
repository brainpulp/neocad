import { describe, it, expect } from 'vitest'
import { sdf, sdfNormal } from '../../src/sdf/eval'
import {
  box,
  cylinder,
  intersect,
  plane,
  smoothUnion,
  sphere,
  subtract,
  torus,
  transform,
  translate,
  union,
} from '../../src/sdf/tree'

const near = (a: number, b: number, digits = 5) => expect(a).toBeCloseTo(b, digits)

describe('sdf primitives', () => {
  it('sphere: outside / on-surface / inside', () => {
    const s = sphere(1)
    near(sdf(s, [2, 0, 0]), 1)
    near(sdf(s, [1, 0, 0]), 0)
    near(sdf(s, [0, 0, 0]), -1)
  })

  it('box: face, corner-region, inside', () => {
    const b = box([1, 1, 1])
    near(sdf(b, [2, 0, 0]), 1) // 1 past the +x face
    near(sdf(b, [1, 0, 0]), 0) // on the face
    near(sdf(b, [0, 0, 0]), -1) // center, distance to nearest face
    near(sdf(b, [2, 2, 2]), Math.sqrt(3)) // out past a corner
  })

  it('cylinder: radial and axial faces (axis = Y)', () => {
    const c = cylinder(1, 2) // radius 1, height 2 → half-height 1
    near(sdf(c, [2, 0, 0]), 1) // radial
    near(sdf(c, [0, 2, 0]), 1) // axial (top cap at y=1)
    near(sdf(c, [0, 0, 0]), -1) // center
  })

  it('torus: tube surface in the XZ plane', () => {
    const t = torus(2, 0.5)
    near(sdf(t, [2.5, 0, 0]), 0) // on the outer tube surface
    near(sdf(t, [3, 0, 0]), 0.5)
    near(sdf(t, [2, 0, 0]), -0.5) // tube centerline → inside
  })

  it('plane: half-space by signed height', () => {
    const pl = plane([0, 1, 0], 0)
    near(sdf(pl, [0, 2, 0]), 2)
    near(sdf(pl, [7, -3, 4]), -3) // only the normal component matters
  })
})

describe('sdf boolean ops', () => {
  it('union = min of children', () => {
    const two = union(sphere(1), translate([3, 0, 0], sphere(1)))
    near(sdf(two, [1.5, 0, 0]), 0.5) // midway, both 0.5 away
    near(sdf(two, [0, 0, 0]), -1) // inside the first sphere
    near(sdf(two, [3, 0, 0]), -1) // inside the second
  })

  it('subtract carves b out of a', () => {
    const carved = subtract(box([1, 1, 1]), sphere(0.5))
    expect(sdf(carved, [0, 0, 0])).toBeGreaterThan(0) // center is now hollow
    near(sdf(carved, [1, 0, 0]), 0) // outer box face intact
  })

  it('intersect = max of children', () => {
    const lens = intersect(sphere(1), translate([0.5, 0, 0], sphere(1)))
    near(sdf(lens, [0.25, 0, 0]), Math.max(sdf(sphere(1), [0.25, 0, 0]), sdf(sphere(1), [-0.25, 0, 0])))
  })

  it('smoothUnion rounds the seam (≤ hard min) and matches min far away', () => {
    const a = sphere(1)
    const b = translate([1.5, 0, 0], sphere(1))
    const hard = Math.min(sdf(a, [0.75, 0, 0]), sdf(b, [0.75, 0, 0]))
    const soft = sdf(smoothUnion(a, b, 0.4), [0.75, 0, 0])
    expect(soft).toBeLessThanOrEqual(hard + 1e-9) // smooth min never exceeds hard min
    // Far from the seam it collapses back to the nearer surface.
    const far = sdf(smoothUnion(a, b, 0.4), [-3, 0, 0])
    near(far, sdf(a, [-3, 0, 0]), 3)
  })
})

describe('sdf transform', () => {
  it('translate moves the field', () => {
    const s = translate([5, 0, 0], sphere(1))
    near(sdf(s, [5, 0, 0]), -1)
    near(sdf(s, [7, 0, 0]), 1)
  })

  it('uniform scale scales distances (radius-2 sphere via scaled unit sphere)', () => {
    const s = transform(sphere(1), { scale: 2 })
    near(sdf(s, [3, 0, 0]), 1) // == a sphere of radius 2: 3 - 2
    near(sdf(s, [0, 0, 0]), -2)
  })
})

describe('sdfNormal', () => {
  it('points radially outward on a sphere', () => {
    const n = sdfNormal(sphere(1), [1, 0, 0])
    near(n[0], 1, 3)
    expect(Math.abs(n[1])).toBeLessThan(1e-3)
    expect(Math.abs(n[2])).toBeLessThan(1e-3)
  })

  it('points up on the top face of a box', () => {
    const n = sdfNormal(box([1, 1, 1]), [0, 1, 0])
    near(n[1], 1, 3)
  })
})
