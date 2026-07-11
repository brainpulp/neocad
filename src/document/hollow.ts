import { STOCK } from './catalog'
import type { Piece, Vec3 } from './types'

/**
 * Hollow shapes as a shared "wall brick" description. ONE decomposition feeds
 * both the physics compound (each brick → a Jolt BoxShape) and the render mesh
 * (each brick → a translated BoxGeometry), so what you see is exactly what
 * collides. See docs/superpowers/specs/2026-07-04-hollow-holes-rendering.md.
 */

export type FaceId = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export interface Hollow {
  /** Wall thickness in metres. */
  thickness: number
  /**
   * Box: which face is left OPEN (a wall removed → an open-top container).
   * Cylinder: '+y'/'-y' opens that cap (a cup); unset = tube (both ends open).
   */
  openFace?: FaceId
}

/** An axis-aligned wall, piece-local. Rotation is baked into the offsets/halfs. */
export interface WallBrick {
  center: Vec3
  half: Vec3
}

/** True when hollowing this stock is meaningful (box or cylinder in v1). */
export function hollowable(piece: Piece): boolean {
  const p = STOCK[piece.stockType].primitive
  return p === 'box' || p === 'cylinder'
}

/** Clamp a requested thickness to something that leaves a real cavity. */
export function clampThickness(piece: Piece, thickness: number): number {
  const d = piece.dimensions
  const p = STOCK[piece.stockType].primitive
  const limit =
    p === 'box'
      ? Math.min(d.x, d.y, d.z) / 2 - 0.002
      : d.radius - 0.002 // cylinder: wall can't exceed the radius
  return Math.max(0.002, Math.min(thickness, Math.max(0.002, limit)))
}

/**
 * Non-overlapping shell decomposition of a hollow BOX. Standard 6-wall split:
 * the ±x walls are full slabs; the ±y walls shrink in x; the ±z walls shrink
 * in x and y — so no two bricks double-cover an edge (clean mass + no
 * z-fighting). The wall named by `openFace` is omitted.
 */
function boxWalls(d: Record<string, number>, t: number, openFace?: FaceId): WallBrick[] {
  const hx = d.x / 2
  const hy = d.y / 2
  const hz = d.z / 2
  const inx = Math.max(0.001, hx - t)
  const iny = Math.max(0.001, hy - t)
  const t2 = t / 2
  const walls: { face: FaceId; brick: WallBrick }[] = [
    { face: '+x', brick: { center: [hx - t2, 0, 0], half: [t2, hy, hz] } },
    { face: '-x', brick: { center: [-(hx - t2), 0, 0], half: [t2, hy, hz] } },
    { face: '+y', brick: { center: [0, hy - t2, 0], half: [inx, t2, hz] } },
    { face: '-y', brick: { center: [0, -(hy - t2), 0], half: [inx, t2, hz] } },
    { face: '+z', brick: { center: [0, 0, hz - t2], half: [inx, iny, t2] } },
    { face: '-z', brick: { center: [0, 0, -(hz - t2)], half: [inx, iny, t2] } },
  ]
  return walls.filter((w) => w.face !== openFace).map((w) => w.brick)
}

/**
 * Hollow CYLINDER wall as a ring of box segments around the barrel (axis = y),
 * plus end caps unless the end is open. A dodecagon-ish ring reads as round and
 * collides honestly; the tube stock finally has a real bore. `openFace` '+y'
 * or '-y' removes that cap (a cup); unset removes both (a tube).
 */
function cylinderWalls(d: Record<string, number>, t: number, openFace?: FaceId): WallBrick[] {
  const R = d.radius
  const hh = d.height / 2
  const wallR = R - t / 2 // radius to each segment's centre
  const SEG = 12
  const bricks: WallBrick[] = []
  // Each segment is a thin box tangent to the mean wall circle. Its half-width
  // (tangential) spans one slice; half-depth is t/2 (radial); half-height hh.
  const halfTangent = wallR * Math.tan(Math.PI / SEG)
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2
    const cx = Math.cos(a) * wallR
    const cz = Math.sin(a) * wallR
    // Axis-aligned bounding brick for this segment (rotation baked by using a
    // conservative AABB): width covers tangent+radial extent. Kept simple and
    // slightly generous so the ring has no gaps.
    const nx = Math.abs(Math.cos(a))
    const nz = Math.abs(Math.sin(a))
    const halfX = nx * (t / 2) + nz * halfTangent
    const halfZ = nz * (t / 2) + nx * halfTangent
    bricks.push({ center: [cx, 0, cz], half: [Math.max(0.002, halfX), hh, Math.max(0.002, halfZ)] })
  }
  const capHalf = R
  if (openFace !== '+y') bricks.push({ center: [0, hh - t / 2, 0], half: [capHalf, t / 2, capHalf] })
  if (openFace !== '-y') bricks.push({ center: [0, -(hh - t / 2), 0], half: [capHalf, t / 2, capHalf] })
  // Default (no openFace) = tube: BOTH caps removed.
  if (!openFace) return bricks.slice(0, SEG)
  return bricks
}

/** Wall bricks for a hollow piece, or null when it isn't hollow / not hollowable. */
export function hollowBricks(piece: Piece): WallBrick[] | null {
  if (!piece.hollow || !hollowable(piece)) return null
  const t = clampThickness(piece, piece.hollow.thickness)
  const primitive = STOCK[piece.stockType].primitive
  if (primitive === 'box') return boxWalls(piece.dimensions, t, piece.hollow.openFace)
  if (primitive === 'cylinder') return cylinderWalls(piece.dimensions, t, piece.hollow.openFace)
  return null
}

/** Solid volume of the walls (m³) — the cavity is subtracted vs the solid piece. */
export function hollowVolume(piece: Piece): number {
  const bricks = hollowBricks(piece)
  if (!bricks) return 0
  return bricks.reduce((sum, b) => sum + 8 * b.half[0] * b.half[1] * b.half[2], 0)
}
