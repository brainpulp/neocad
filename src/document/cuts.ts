import type { Piece } from './types'

/**
 * Negative-space cuts on a piece (M-Cuts). A piece keeps its base stock shape and
 * carries a list of subtractive tools; the meshed result (base − tools) is exact
 * and watertight via manifold-3d (see `render/csg.ts`). Pure data here — no three,
 * no wasm — so the document layer stays engine-free.
 */

/** A tool cut. v1: a `bore` (cylinder) through the piece along a principal axis. */
export interface CutOp {
  id: string
  tool: 'bore'
  radius: number
  /** Principal axis the bore runs along. */
  axis: 'x' | 'y' | 'z'
  /** Position of the bore centre on the two axes perpendicular to `axis` (metres). */
  offset: [number, number]
}

/** An abstract CSG expression, evaluated to geometry by the manifold engine. */
export type CsgNode =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'cylinder'; radius: number; height: number } // Y-axis, centered
  | { kind: 'sphere'; radius: number }
  | { kind: 'subtract'; a: CsgNode; b: CsgNode }
  | { kind: 'union'; children: CsgNode[] } // batch boolean-OR (assembling many parts, e.g. a stair)
  | { kind: 'transform'; translate?: [number, number, number]; rotate?: [number, number, number]; child: CsgNode } // rotate = Euler degrees

const csgSubtract = (a: CsgNode, b: CsgNode): CsgNode => ({ kind: 'subtract', a, b })

/** The piece's solid base as a CSG primitive — box or cylinder (the drillable
 * stock). Returns null for shapes we don't cut yet (sphere/wedge/mechanical). */
function baseCsg(piece: Piece): CsgNode | null {
  const d = piece.dimensions
  if ('x' in d && 'y' in d && 'z' in d) return { kind: 'box', size: [d.x, d.y, d.z] }
  if ('radius' in d && 'height' in d) return { kind: 'cylinder', radius: d.radius, height: d.height }
  return null
}

/** Longest span of the piece — used to make a bore long enough to pass through. */
function through(piece: Piece): number {
  return Math.max(1, ...Object.values(piece.dimensions)) * 2 + 1
}

/** A bore tool oriented + placed in the piece's local frame. */
function boreTool(piece: Piece, cut: CutOp): CsgNode {
  const len = through(piece)
  const cyl: CsgNode = { kind: 'cylinder', radius: cut.radius, height: len } // Y-axis
  const [u, v] = cut.offset
  switch (cut.axis) {
    case 'y':
      return { kind: 'transform', translate: [u, 0, v], child: cyl }
    case 'x':
      return { kind: 'transform', rotate: [0, 0, 90], translate: [0, u, v], child: cyl }
    case 'z':
      return { kind: 'transform', rotate: [90, 0, 0], translate: [u, v, 0], child: cyl }
  }
}

/**
 * Build the CSG tree for a piece with cuts (base − every tool), or null when the
 * piece has no cuts / an uncuttable base — callers then use the plain primitive.
 */
export function pieceToCsg(piece: Piece): CsgNode | null {
  if (!piece.cuts?.length) return null
  const base = baseCsg(piece)
  if (!base) return null
  return piece.cuts.reduce<CsgNode>((solid, cut) => csgSubtract(solid, boreTool(piece, cut)), base)
}

/** Stable key over a piece's cuts — for memoizing the (expensive) mesh. */
export function cutsKey(piece: Piece): string {
  if (!piece.cuts?.length) return ''
  return piece.cuts.map((c) => `${c.tool}:${c.radius}:${c.axis}:${c.offset.join(',')}`).join('|')
}

let cutSeq = 0
export function nextCutId(): string {
  return `cut_${++cutSeq}`
}
