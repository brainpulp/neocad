import { STOCK } from './catalog'
import {
  cross,
  dot,
  length,
  localToWorld,
  normalize,
  perpendicular,
  scale,
  sub,
  worldDirToLocal,
} from './math'
import type { Piece, Transform, Vec3 } from './types'

/**
 * Surface contact geometry for the joining gesture. Joining bonds parts in
 * SURFACE CONTACT (see docs/superpowers/specs/2026-07-04-joints-literal-redesign.md):
 * the clicked surfaces touch, outward normals opposed — never buried, never
 * floating. This module answers two questions the old feature system couldn't:
 *   • surfaceAnchor — where IS the surface near this click, and which way does
 *     it face? (Features gave centerlines: for shafts that means burial.)
 *   • piecesOverlap — would this landing interpenetrate? (The collision veto.)
 */

export interface SurfaceAnchor {
  /** Point ON the piece's surface, piece-local. */
  point: Vec3
  /** Outward surface normal at that point, piece-local, unit. */
  normal: Vec3
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Nearest surface point + outward normal for a piece-local point (in or out). */
export function surfaceAnchor(piece: Piece, local: Vec3): SurfaceAnchor {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'sphere': {
      const n = length(local) < 1e-9 ? ([0, 1, 0] as Vec3) : normalize(local)
      return { point: scale(n, d.radius), normal: n }
    }
    case 'cylinder': {
      const h2 = d.height / 2
      const rl = Math.hypot(local[0], local[2])
      // Signed distance to barrel vs caps: the LESS negative wins (nearest surface).
      const dBarrel = rl - d.radius
      const dCap = Math.abs(local[1]) - h2
      if (dCap > dBarrel) {
        const s = local[1] >= 0 ? 1 : -1
        const rr = rl > d.radius ? d.radius / rl : 1
        return {
          point: [local[0] * rr, s * h2, local[2] * rr],
          normal: [0, s, 0],
        }
      }
      const nr: Vec3 = rl < 1e-9 ? [1, 0, 0] : [local[0] / rl, 0, local[2] / rl]
      return {
        point: [nr[0] * d.radius, clamp(local[1], -h2, h2), nr[2] * d.radius],
        normal: nr,
      }
    }
    case 'box': {
      const h: Vec3 = [d.x / 2, d.y / 2, d.z / 2]
      // Face with the largest signed distance = the face the click is nearest.
      let axis = 0
      let best = -Infinity
      for (let i = 0; i < 3; i++) {
        const sd = Math.abs(local[i]) - h[i]
        if (sd > best) {
          best = sd
          axis = i
        }
      }
      const s = local[axis] >= 0 ? 1 : -1
      const point: Vec3 = [
        clamp(local[0], -h[0], h[0]),
        clamp(local[1], -h[1], h[1]),
        clamp(local[2], -h[2], h[2]),
      ]
      point[axis] = s * h[axis]
      const normal: Vec3 = [0, 0, 0]
      normal[axis] = s
      return { point, normal }
    }
    case 'wedge': {
      // Prism (render/mechanical.ts wedgeGeometry): bottom at −hy, back at −hx,
      // top edge along z at (−hx,+hy), slope facing +x+y, triangle ends at ±hz.
      const hx = d.x / 2
      const hy = d.y / 2
      const hz = d.z / 2
      const slopeN = normalize([d.y, d.x, 0])
      const faces: { n: Vec3; off: number }[] = [
        { n: [0, -1, 0], off: hy },
        { n: [-1, 0, 0], off: hx },
        { n: slopeN, off: 0 }, // passes through (±hx, ∓hy): offset 0
        { n: [0, 0, 1], off: hz },
        { n: [0, 0, -1], off: hz },
      ]
      let bestFace = faces[0]
      let best = -Infinity
      for (const f of faces) {
        const sd = dot(f.n, local) - f.off
        if (sd > best) {
          best = sd
          bestFace = f
        }
      }
      const onPlane = sub(local, scale(bestFace.n, dot(bestFace.n, local) - bestFace.off))
      const point: Vec3 = [
        clamp(onPlane[0], -hx, hx),
        clamp(onPlane[1], -hy, hy),
        clamp(onPlane[2], -hz, hz),
      ]
      return { point, normal: bestFace.n }
    }
  }
}

/** Farthest point of the piece along a piece-local direction (support function). */
export function supportLocal(piece: Piece, dir: Vec3): Vec3 {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'sphere':
      return scale(normalize(dir), d.radius)
    case 'box':
      return [
        (dir[0] >= 0 ? 1 : -1) * (d.x / 2),
        (dir[1] >= 0 ? 1 : -1) * (d.y / 2),
        (dir[2] >= 0 ? 1 : -1) * (d.z / 2),
      ]
    case 'cylinder': {
      const rl = Math.hypot(dir[0], dir[2])
      const y = (dir[1] >= 0 ? 1 : -1) * (d.height / 2)
      if (rl < 1e-9) return [0, y, 0]
      return [(dir[0] / rl) * d.radius, y, (dir[2] / rl) * d.radius]
    }
    case 'wedge': {
      const hx = d.x / 2
      const hy = d.y / 2
      const hz = d.z / 2
      const verts: Vec3[] = [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
        [-hx, hy, -hz],
        [-hx, hy, hz],
      ]
      let best = verts[0]
      let bestDot = -Infinity
      for (const v of verts) {
        const dd = dot(v, dir)
        if (dd > bestDot) {
          bestDot = dd
          best = v
        }
      }
      return best
    }
  }
}

type Support = (dirWorld: Vec3) => Vec3

/**
 * World-space support of a piece at a pose, optionally SHRUNK by `margin` metres
 * (erodes the shape so exact-touch contacts don't read as overlap).
 */
function supportWorld(piece: Piece, t: Transform, margin: number): Support {
  return (dirWorld: Vec3) => {
    const dl = normalize(worldDirToLocal(t, dirWorld))
    let p = supportLocal(piece, dl)
    if (margin > 0) p = sub(p, scale(dl, margin))
    return localToWorld(t, p)
  }
}

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]

/**
 * GJK boolean intersection between two convex supports.
 *
 * Robustness rules (learned the hard way — box-vs-box produces DEGENERATE
 * simplexes constantly: coplanar supports → zero-area triangles → zero
 * search direction, which a naive loop misreads as "origin inside"):
 *  • zero direction from a degenerate simplex = touching boundary → NOT overlap
 *    (the veto is for burial; a kiss must pass);
 *  • a repeated support point = no progress possible → origin unreachable → NOT overlap;
 *  • only the tetrahedron containment test may answer "overlap".
 */
function gjkIntersect(sa: Support, sb: Support): boolean {
  const support = (d: Vec3): Vec3 => sub(sa(d), sb(neg(d)))
  let dir: Vec3 = [1, 0, 0]
  const pts: Vec3[] = [support(dir)]
  dir = neg(pts[0])
  for (let iter = 0; iter < 48; iter++) {
    if (length(dir) < 1e-8) return false // degenerate/boundary: touch, not burial
    const dn = normalize(dir)
    const a = support(dn)
    if (dot(a, dn) < 1e-9) return false // can't reach past the origin
    if (pts.some((p) => length(sub(p, a)) < 1e-9)) return false // no progress
    pts.push(a)
    const res = nearestSimplex(pts)
    if (res.contains) return true
    dir = res.dir
  }
  return false // no convergence after 48 iters = grazing case; let it pass
}

/**
 * Direction from an edge toward the origin: (AB × AO) × AB. When AO is
 * PARALLEL to AB the triple cross vanishes — that does NOT mean the origin is
 * on the edge (it can be far away along the edge line); probe any
 * perpendicular so the search keeps moving instead of stalling on a zero.
 */
function edgeDir(AB: Vec3, AO: Vec3): Vec3 {
  const d = cross(cross(AB, AO), AB)
  return length(d) > 1e-12 ? d : perpendicular(AB)
}

function lineCase(pts: Vec3[], A: Vec3, B: Vec3, AO: Vec3): { contains: false; dir: Vec3 } {
  const AB = sub(B, A)
  if (dot(AB, AO) > 0) {
    pts.length = 0
    pts.push(B, A)
    return { contains: false, dir: edgeDir(AB, AO) }
  }
  pts.length = 0
  pts.push(A)
  return { contains: false, dir: AO }
}

function triangleCase(pts: Vec3[], A: Vec3, B: Vec3, C: Vec3, AO: Vec3): { contains: boolean; dir: Vec3 } {
  const AB = sub(B, A)
  const AC = sub(C, A)
  const n = cross(AB, AC)
  // Degenerate (collinear) triangle: fall back to the longer edge as a line.
  if (length(n) < 1e-12) {
    const far = length(sub(B, A)) >= length(sub(C, A)) ? B : C
    return lineCase(pts, A, far, AO)
  }
  if (dot(cross(n, AC), AO) > 0) {
    if (dot(AC, AO) > 0) {
      pts.length = 0
      pts.push(C, A)
      return { contains: false, dir: edgeDir(AC, AO) }
    }
    return lineCase(pts, A, B, AO)
  }
  if (dot(cross(AB, n), AO) > 0) return lineCase(pts, A, B, AO)
  if (dot(n, AO) > 0) {
    pts.length = 0
    pts.push(C, B, A)
    return { contains: false, dir: n }
  }
  pts.length = 0
  pts.push(B, C, A)
  return { contains: false, dir: neg(n) }
}

function nearestSimplex(pts: Vec3[]): { contains: boolean; dir: Vec3 } {
  const A = pts[pts.length - 1]
  const AO = neg(A)
  if (pts.length === 2) return lineCase(pts, A, pts[0], AO)
  if (pts.length === 3) return triangleCase(pts, A, pts[1], pts[0], AO)
  // Tetrahedron [D, C, B, A], A newest. Check the three faces containing A.
  const B = pts[2]
  const C = pts[1]
  const D = pts[0]
  const AB = sub(B, A)
  const AC = sub(C, A)
  const AD = sub(D, A)
  const nABC = cross(AB, AC)
  const nACD = cross(AC, AD)
  const nADB = cross(AD, AB)
  const outward = (n: Vec3, opposite: Vec3): Vec3 =>
    dot(n, sub(opposite, A)) > 0 ? neg(n) : n
  const oABC = outward(nABC, D)
  const oACD = outward(nACD, B)
  const oADB = outward(nADB, C)
  if (dot(oABC, AO) > 0) return triangleCase(pts, A, B, C, AO)
  if (dot(oACD, AO) > 0) return triangleCase(pts, A, C, D, AO)
  if (dot(oADB, AO) > 0) return triangleCase(pts, A, D, B, AO)
  return { contains: true, dir: [0, 0, 0] }
}

/**
 * Do two pieces (at given poses) interpenetrate by more than ~2×margin?
 * Exact touch and small kisses are NOT overlap — the veto is for burial,
 * not for the contact the landing deliberately creates.
 */
export function piecesOverlap(
  a: Piece,
  ta: Transform,
  b: Piece,
  tb: Transform,
  margin = 0.003,
): boolean {
  return gjkIntersect(supportWorld(a, ta, margin), supportWorld(b, tb, margin))
}
