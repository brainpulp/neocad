import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STOCK } from '../document/catalog'
import { clampThickness, hollowBricks } from '../document/hollow'
import type { Piece } from '../document/types'

/**
 * Render geometry for a hollow piece.
 *
 * Boxes use the SAME wall bricks the physics compound uses (each a BoxGeometry,
 * merged) — the walls are axis-aligned boxes, so what you see is exactly what
 * collides.
 *
 * Cylinders render as a smooth LATHE of the wall's cross-section (a real round
 * tube/cup with visible wall thickness). Physics still uses a 12-segment box
 * ring; the round-vs-dodecagon gap is sub-1% of the radius — a fair trade for
 * a tube that looks like a tube instead of a stack of blocks.
 *
 * Returns null when the piece isn't hollow (caller keeps the analytic shape).
 */
export function hollowGeometry(piece: Piece): THREE.BufferGeometry | null {
  if (!piece.hollow) return null
  const primitive = STOCK[piece.stockType].primitive
  if (primitive === 'cylinder') return latheTube(piece)
  const bricks = hollowBricks(piece)
  if (!bricks || bricks.length === 0) return null
  const parts = bricks.map((b) => {
    const g = new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2)
    g.translate(b.center[0], b.center[1], b.center[2])
    return g
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/** A round tube/cup: revolve the wall cross-section outline about the y axis. */
function latheTube(piece: Piece): THREE.BufferGeometry {
  const R = piece.dimensions.radius
  const hh = piece.dimensions.height / 2
  const t = clampThickness(piece, piece.hollow!.thickness)
  const ri = Math.max(0.001, R - t)
  const open = piece.hollow!.openFace
  const V = (x: number, y: number) => new THREE.Vector2(x, y)
  let profile: THREE.Vector2[]
  if (open === '+y') {
    // Cup, open at the top: closed floor at the bottom.
    profile = [V(0, -hh), V(R, -hh), V(R, hh), V(ri, hh), V(ri, -hh + t), V(0, -hh + t)]
  } else if (open === '-y') {
    // Cup, open at the bottom.
    profile = [V(0, hh), V(R, hh), V(R, -hh), V(ri, -hh), V(ri, hh - t), V(0, hh - t)]
  } else {
    // Tube: both ends open — just the annular wall with rims.
    profile = [V(R, -hh), V(R, hh), V(ri, hh), V(ri, -hh)]
  }
  // Close the loop so the revolve caps the rims/floor cleanly.
  profile.push(profile[0].clone())
  return new THREE.LatheGeometry(profile, 48)
}
