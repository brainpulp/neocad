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
  return { kind: 'transform', translate: p.center, child: { kind: 'box', size: p.size } }
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
  return [
    spec.totalRise,
    spec.width,
    spec.going,
    spec.treadThickness,
    spec.nosing,
    spec.riserMode,
    spec.riserThickness,
    sizing,
  ].join('|')
}
