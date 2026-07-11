import Module, { type ManifoldToplevel, type Manifold } from 'manifold-3d'
import { BufferAttribute, BufferGeometry } from 'three'
import type { Vec3 } from '../document/types'

/**
 * Exact, watertight boolean geometry via manifold-3d — the "machinist" engine
 * for M-Cuts (drilling, negative shapes). A tiny op-tree mirrors the SDF core's
 * shape so both can eventually feed the builder through one meshed-body type;
 * the difference is that these booleans are EXACT (sharp edges, guaranteed
 * 2-manifold output) rather than sampled/approximate.
 *
 * Cylinders are Y-axis + centered to match the builder's stock convention
 * (manifold's native cylinder is Z-axis).
 */
export type CsgNode =
  | { kind: 'box'; size: Vec3 } // full size, centered at origin
  | { kind: 'cylinder'; radius: number; height: number; segments?: number }
  | { kind: 'sphere'; radius: number; segments?: number }
  | { kind: 'subtract'; a: CsgNode; b: CsgNode } // a minus b
  | { kind: 'union'; a: CsgNode; b: CsgNode }
  | { kind: 'intersect'; a: CsgNode; b: CsgNode }
  | { kind: 'transform'; translate?: Vec3; rotate?: Vec3; child: CsgNode } // rotate = Euler degrees

// --- Builder helpers (read like code) -------------------------------------

export const csgBox = (size: Vec3): CsgNode => ({ kind: 'box', size })
export const csgCylinder = (radius: number, height: number, segments = 64): CsgNode => ({
  kind: 'cylinder',
  radius,
  height,
  segments,
})
export const csgSphere = (radius: number, segments = 48): CsgNode => ({
  kind: 'sphere',
  radius,
  segments,
})
export const csgSubtract = (a: CsgNode, b: CsgNode): CsgNode => ({ kind: 'subtract', a, b })
export const csgUnion = (a: CsgNode, b: CsgNode): CsgNode => ({ kind: 'union', a, b })
export const csgIntersect = (a: CsgNode, b: CsgNode): CsgNode => ({ kind: 'intersect', a, b })
export const csgTransform = (
  child: CsgNode,
  opts: { translate?: Vec3; rotate?: Vec3 } = {},
): CsgNode => ({ kind: 'transform', child, ...opts })

// --- WASM lifecycle (singleton) -------------------------------------------

let topPromise: Promise<ManifoldToplevel> | null = null

/**
 * Initialize the manifold WASM once. In the browser (Vite) pass the served
 * wasm URL (`import wasm from 'manifold-3d/manifold.wasm?url'`); in Node the
 * default on-disk resolution works, so the arg is omitted.
 */
export function initCsg(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!topPromise) {
    topPromise = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((top) => {
      top.setup()
      return top
    })
  }
  return topPromise
}

// --- Build + convert ------------------------------------------------------

function build(top: ManifoldToplevel, node: CsgNode): Manifold {
  const M = top.Manifold
  switch (node.kind) {
    case 'box':
      return M.cube(node.size, true)
    case 'cylinder': {
      const z = M.cylinder(node.height, node.radius, node.radius, node.segments ?? 64, true)
      const y = z.rotate([90, 0, 0]) // Z-axis → Y-axis (stock convention)
      z.delete()
      return y
    }
    case 'sphere':
      return M.sphere(node.radius, node.segments ?? 48)
    case 'subtract':
    case 'union':
    case 'intersect': {
      const a = build(top, node.a)
      const b = build(top, node.b)
      const r =
        node.kind === 'subtract' ? a.subtract(b) : node.kind === 'union' ? a.add(b) : a.intersect(b)
      a.delete()
      b.delete()
      return r
    }
    case 'transform': {
      let m = build(top, node.child)
      if (node.rotate) {
        const n = m.rotate(node.rotate)
        m.delete()
        m = n
      }
      if (node.translate) {
        const n = m.translate(node.translate)
        m.delete()
        m = n
      }
      return m
    }
  }
}

/** manifold Mesh → three BufferGeometry (indexed, positions de-interleaved). */
function meshToGeometry(mesh: {
  vertProperties: Float32Array
  triVerts: Uint32Array
  numProp: number
}): BufferGeometry {
  const np = mesh.numProp
  let positions: Float32Array
  if (np === 3) {
    positions = mesh.vertProperties
  } else {
    const n = mesh.vertProperties.length / np
    positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      positions[i * 3] = mesh.vertProperties[i * np]
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setIndex(new BufferAttribute(mesh.triVerts, 1))
  geo.computeVertexNormals()
  return geo
}

/**
 * Evaluate a CSG tree to a watertight `BufferGeometry`. Async because the WASM
 * loads on first use; subsequent calls are synchronous inside.
 */
export async function csgToGeometry(node: CsgNode, wasmUrl?: string): Promise<BufferGeometry> {
  const top = await initCsg(wasmUrl)
  const m = build(top, node)
  const mesh = m.getMesh()
  m.delete()
  return meshToGeometry(mesh as unknown as {
    vertProperties: Float32Array
    triVerts: Uint32Array
    numProp: number
  })
}
