/**
 * Stair geometry — folds the pure layout parts into a `CsgNode` tree that the
 * shared manifold kernel (`render/csg.ts`) meshes to one exact, watertight solid.
 * Reuses NeoCad's CSG machinery wholesale: `csgToGeometry` for render + export,
 * and (later) `csgMeshSync` for a static Jolt MeshShape when a stair is dropped
 * into the sandbox.
 */
import type { CsgNode } from '../document/cuts'
import type { StairSpec } from './spec'
import { layoutStair, type Part } from './layout'

function partToCsg(p: Part): CsgNode {
  if (p.shape === 'prism') {
    return { kind: 'extrude', polygon: p.polygon, bottom: p.bottom, top: p.top }
  }
  // A box: pitch about local X (stringer rake), then yaw about Y, then place.
  const box: CsgNode = { kind: 'box', size: p.size }
  const pitched: CsgNode = p.pitchDeg ? { kind: 'transform', rotate: [p.pitchDeg, 0, 0], child: box } : box
  const yawed: CsgNode = p.rotYDeg ? { kind: 'transform', rotate: [0, p.rotYDeg, 0], child: pitched } : pitched
  return { kind: 'transform', translate: p.center, child: yawed }
}

/** The whole stair as a single union CsgNode (null if it has no parts). */
export function stairToCsg(spec: StairSpec): CsgNode | null {
  const { parts } = layoutStair(spec)
  if (parts.length === 0) return null
  return { kind: 'union', children: parts.map(partToCsg) }
}

/** Stable key over the parameters that change the geometry — memoises meshing. */
export function stairKey(spec: StairSpec): string {
  const s = spec.sizing
  const sizing = s.mode === 'byCount' ? `c${s.count}` : `r${s.targetRise}`
  const turns = spec.turns
    .map((t) => `${t.angle}${t.direction[0]}${t.kind[0]}${t.landingShape[0]}${t.winderSteps}s${t.stepsBefore ?? 'a'}`)
    .join(',')
  const str = `${spec.stringer.kind}:${spec.stringer.thickness}:${spec.stringer.depth}`
  const R = spec.railing
  const rail = `${R.sides}:${R.height}:${R.postSize}:${R.balusterSize}:${R.balusterGap}`
  return [
    spec.totalRise,
    spec.width,
    spec.going,
    spec.treadThickness,
    spec.nosing,
    spec.riserMode,
    spec.riserThickness,
    sizing,
    turns,
    str,
    rail,
  ].join('|')
}
