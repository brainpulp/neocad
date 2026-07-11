import Module, { type ManifoldToplevel, type Manifold } from 'manifold-3d'
import { BufferAttribute, BufferGeometry } from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CsgNode } from '../document/cuts'

/**
 * Exact watertight boolean meshing via manifold-3d — the geometry engine for
 * M-Cuts. Turns a pure `CsgNode` tree (from `document/cuts.ts`) into a three
 * `BufferGeometry` a drilled hole *actually* exists in: sharp edges, 2-manifold,
 * low-poly. Chosen over SDF surface-nets (rounds edges, 10k+ tris) and
 * three-bvh-csg (non-manifold T-junctions) — see the sdf-modeler spec.
 */

let topPromise: Promise<ManifoldToplevel> | null = null

/** Initialize the manifold WASM once. Pass the Vite-served wasm URL in the app;
 * Node (tests) resolves it on disk, so the arg is omitted there. */
export function initCsg(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!topPromise) {
    topPromise = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((top) => {
      top.setup()
      return top
    })
  }
  return topPromise
}

function build(top: ManifoldToplevel, node: CsgNode): Manifold {
  const M = top.Manifold
  switch (node.kind) {
    case 'box':
      return M.cube(node.size, true)
    case 'cylinder': {
      const z = M.cylinder(node.height, node.radius, node.radius, 64, true)
      const y = z.rotate([90, 0, 0]) // manifold's cylinder is Z-axis; stock is Y
      z.delete()
      return y
    }
    case 'sphere':
      return M.sphere(node.radius, 48)
    case 'subtract': {
      const a = build(top, node.a)
      const b = build(top, node.b)
      const r = a.subtract(b)
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
  // Crease-split normals: hard edges (box corners, the drilled rim) stay sharp
  // while smooth surfaces (the bore wall's 64 facets) shade round — a plain
  // computeVertexNormals would average across the welded edges and melt them.
  return toCreasedNormals(geo, Math.PI / 4)
}

/** Evaluate a CSG tree to a watertight `BufferGeometry` (async: WASM loads on
 * first use, then subsequent calls are fast). */
export async function csgToGeometry(node: CsgNode, wasmUrl?: string): Promise<BufferGeometry> {
  const top = await initCsg(wasmUrl)
  const m = build(top, node)
  const mesh = m.getMesh()
  m.delete()
  return meshToGeometry(
    mesh as unknown as { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number },
  )
}
