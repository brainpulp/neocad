import { STOCK, type Primitive, type VisualKind } from '../document/catalog'
import type { Material, Piece } from '../document/types'

export interface Geometry {
  kind: 'box' | 'cylinder' | 'sphere' | 'wedge'
  /** Geometry constructor args, in Three.js order. */
  args: number[]
}

export interface PieceVisual extends Geometry {
  color: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
  /** Custom mechanical look (gear teeth, pulley groove…); falls back to `kind` if unset. */
  visual?: VisualKind
}

/** Largest extent of a piece, for sizing selection outlines etc. */
export function maxExtent(piece: Piece): number {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return Math.max(d.x, d.y, d.z)
    case 'cylinder':
      return Math.max(d.radius * 2, d.height)
    case 'sphere':
      return d.radius * 2
    case 'wedge':
      return Math.max(d.x, d.y, d.z)
  }
}

const FALLBACK_COLOR = '#cccccc'

/** Pure mapping from a primitive + full-extent dimensions to Three.js geometry. */
export function geometryFor(primitive: Primitive, d: Record<string, number>): Geometry {
  switch (primitive) {
    case 'box':
      return { kind: 'box', args: [d.x, d.y, d.z] }
    case 'cylinder':
      // Three CylinderGeometry: radiusTop, radiusBottom, height, radialSegments
      return { kind: 'cylinder', args: [d.radius, d.radius, d.height, 24] }
    case 'sphere':
      return { kind: 'sphere', args: [d.radius, 24, 16] }
    case 'wedge':
      return { kind: 'wedge', args: [d.x, d.y, d.z] }
  }
}

/** Pure mapping from a piece (+ materials table) to renderable geometry/material. */
export function pieceVisual(piece: Piece, materials: Material[]): PieceVisual {
  const geo = geometryFor(STOCK[piece.stockType].primitive, piece.dimensions)
  const color = materials.find((m) => m.name === piece.material)?.color ?? FALLBACK_COLOR
  return {
    ...geo,
    color,
    position: piece.state.transform.position,
    quaternion: piece.state.transform.rotation,
    visual: STOCK[piece.stockType].visual,
  }
}
