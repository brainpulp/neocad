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
// The initialized toplevel, cached synchronously once the WASM has loaded. This
// lets the physics compiler (which runs synchronously) mesh a cut piece into a
// Jolt shape the moment the kernel is ready — see `csgMeshSync`.
let top: ManifoldToplevel | null = null
const readyCbs = new Set<() => void>()

/** Initialize the manifold WASM once. Pass the Vite-served wasm URL in the app;
 * Node (tests) resolves it on disk, so the arg is omitted there. */
export function initCsg(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!topPromise) {
    topPromise = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((t) => {
      t.setup()
      top = t
      // The kernel loads exactly once; cut pieces compiled into the physics
      // world before it was ready get one rebuild when it becomes available.
      for (const cb of readyCbs) cb()
      readyCbs.clear()
      return t
    })
  }
  return topPromise
}

/**
 * Fire `cb` once the CSG kernel is ready (immediately if it already is). Used by
 * the physics loop to rebuild the world after the WASM finishes loading, so an
 * anchored drilled plate gets its real hole-punched collision mesh.
 */
export function onCsgReady(cb: () => void): void {
  if (top) cb()
  else readyCbs.add(cb)
}

/** True once the kernel is loaded and `csgMeshSync` will return geometry. */
export function csgReady(): boolean {
  return top !== null
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

interface RawMesh {
  vertProperties: Float32Array
  triVerts: Uint32Array
  numProp: number
}

function evalMesh(t: ManifoldToplevel, node: CsgNode): RawMesh {
  const m = build(t, node)
  const mesh = m.getMesh()
  m.delete()
  return mesh as unknown as RawMesh
}

/** Evaluate a CSG tree to a watertight `BufferGeometry` (async: WASM loads on
 * first use, then subsequent calls are fast). */
export async function csgToGeometry(node: CsgNode, wasmUrl?: string): Promise<BufferGeometry> {
  const t = await initCsg(wasmUrl)
  return meshToGeometry(evalMesh(t, node))
}

/**
 * Synchronous meshing for the physics compiler — flat triangle soup (positions
 * + indices) the caller feeds into a Jolt `MeshShape`. Returns null when the
 * kernel hasn't loaded yet; the caller falls back to the solid shape and gets
 * rebuilt via `onCsgReady`. Positions are piece-LOCAL (the base primitive is
 * centred at the origin), exactly what a Jolt shape wants.
 */
export function csgMeshSync(node: CsgNode): { positions: Float32Array; indices: Uint32Array } | null {
  if (!top) return null
  const mesh = evalMesh(top, node)
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
  return { positions, indices: mesh.triVerts }
}
