import type { Vec3 } from '../document/types'
import { quatConjugate, quatRotate } from '../document/math'
import type { SdfNode } from './tree'

// Small vector helpers, local so the SDF core stays self-contained.
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const len2 = (x: number, y: number) => Math.hypot(x, y)
const len3 = (x: number, y: number, z: number) => Math.hypot(x, y, z)

/**
 * Signed distance from world point `p` to the surface of `node` — negative
 * inside, ~exact for the analytic primitives (smooth ops and non-uniform blends
 * are the usual SDF underestimates). Mirrors `sdfToGlsl` formula-for-formula.
 */
export function sdf(node: SdfNode, p: Vec3): number {
  switch (node.kind) {
    case 'sphere':
      return len3(p[0], p[1], p[2]) - node.r

    case 'box': {
      const qx = Math.abs(p[0]) - node.half[0]
      const qy = Math.abs(p[1]) - node.half[1]
      const qz = Math.abs(p[2]) - node.half[2]
      const outside = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0)
      return outside + inside
    }

    case 'roundBox': {
      // `half` is the OUTER half-extent; shrink the box by radius then round.
      const bx = Math.max(node.half[0] - node.radius, 0)
      const by = Math.max(node.half[1] - node.radius, 0)
      const bz = Math.max(node.half[2] - node.radius, 0)
      const qx = Math.abs(p[0]) - bx
      const qy = Math.abs(p[1]) - by
      const qz = Math.abs(p[2]) - bz
      const outside = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
      const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0)
      return outside + inside - node.radius
    }

    case 'cylinder': {
      // Axis = Y, centered at origin.
      const dx = len2(p[0], p[2]) - node.radius
      const dy = Math.abs(p[1]) - node.height / 2
      const outside = len2(Math.max(dx, 0), Math.max(dy, 0))
      const inside = Math.min(Math.max(dx, dy), 0)
      return outside + inside
    }

    case 'torus': {
      // Ring in the XZ plane.
      const qx = len2(p[0], p[2]) - node.major
      return len2(qx, p[1]) - node.minor
    }

    case 'plane': {
      const n = node.normal
      const inv = 1 / (len3(n[0], n[1], n[2]) || 1)
      return (p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) * inv + node.offset
    }

    case 'union':
      return Math.min(sdf(node.a, p), sdf(node.b, p))

    case 'subtract':
      return Math.max(sdf(node.a, p), -sdf(node.b, p))

    case 'intersect':
      return Math.max(sdf(node.a, p), sdf(node.b, p))

    case 'smoothUnion': {
      const a = sdf(node.a, p)
      const b = sdf(node.b, p)
      const k = node.k
      const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
      return mix(b, a, h) - k * h * (1 - h)
    }

    case 'smoothSubtract': {
      const a = sdf(node.a, p)
      const b = sdf(node.b, p)
      const k = node.k
      const h = clamp(0.5 - (0.5 * (a + b)) / k, 0, 1)
      return mix(a, -b, h) + k * h * (1 - h)
    }

    case 'smoothIntersect': {
      const a = sdf(node.a, p)
      const b = sdf(node.b, p)
      const k = node.k
      const h = clamp(0.5 - (0.5 * (b - a)) / k, 0, 1)
      return mix(b, a, h) + k * h * (1 - h)
    }

    case 'transform': {
      // Map p into the child's local frame: undo translate, undo rotate, undo
      // uniform scale; distances scale back up by the scale factor.
      const rel: Vec3 = [p[0] - node.translate[0], p[1] - node.translate[1], p[2] - node.translate[2]]
      const local = quatRotate(quatConjugate(node.rotate), rel)
      const s = node.scale
      const scaled: Vec3 = [local[0] / s, local[1] / s, local[2] / s]
      return sdf(node.child, scaled) * s
    }
  }
}

/** Numerical surface normal via the tetrahedron gradient of the field. */
export function sdfNormal(node: SdfNode, p: Vec3, eps = 1e-4): Vec3 {
  const k = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
  ] as const
  let nx = 0
  let ny = 0
  let nz = 0
  for (const [sx, sy, sz] of k) {
    const d = sdf(node, [p[0] + sx * eps, p[1] + sy * eps, p[2] + sz * eps])
    nx += sx * d
    ny += sy * d
    nz += sz * d
  }
  const inv = 1 / (len3(nx, ny, nz) || 1)
  return [nx * inv, ny * inv, nz * inv]
}
