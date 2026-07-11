import type { JoltModule } from './jolt'
import type { Primitive } from '../document/catalog'
import { hollowBricks } from '../document/hollow'
import { pieceToCsg } from '../document/cuts'
import { csgMeshSync } from '../render/csg'
import type { Piece } from '../document/types'

/**
 * Collision-edge rounding ("the Clavicula lesson"): SDF modelers feel organic
 * under physics not because of an exotic solver — Clavicula itself runs plain
 * Bullet — but because SDF-modeled shapes carry a small fillet on every edge,
 * so contacts engage smoothly instead of catching on razor-sharp corners.
 * Jolt's convex radius gives us the same for free: a few millimetres of edge
 * rounding on chunky stock. Capped at a quarter of the smallest half-extent so
 * thin stock (a 12 mm slat) stays valid — radius 0 was the old blanket rule to
 * avoid Jolt's convex-radius assertion on thin boxes.
 */
function edgeRadius(...halfExtents: number[]): number {
  return Math.min(0.005, 0.25 * Math.min(...halfExtents))
}

/**
 * Compound shape from hollow wall bricks (box/tube). The SAME brick list the
 * renderer meshes, so collision matches the visible walls exactly: a ball
 * dropped into an open-top box is really contained; a dowel really passes
 * through a tube's bore. Works for dynamic bodies too (the compound is rigid,
 * only the arrangement is fixed).
 */
export function makeHollowShape(Jolt: JoltModule, piece: Piece): any | null {
  const bricks = hollowBricks(piece)
  if (!bricks || bricks.length === 0) return null
  const settings = new Jolt.StaticCompoundShapeSettings()
  const noRot = new Jolt.Quat(0, 0, 0, 1)
  for (const b of bricks) {
    const r = edgeRadius(b.half[0], b.half[1], b.half[2])
    // AddShape wants a ShapeSettings (not a built Shape) + a userData arg.
    const wall = new Jolt.BoxShapeSettings(new Jolt.Vec3(b.half[0], b.half[1], b.half[2]), r)
    settings.AddShape(new Jolt.Vec3(b.center[0], b.center[1], b.center[2]), noRot, wall, 0)
  }
  const result = settings.Create()
  if (result.HasError()) throw new Error(`hollow compound: ${result.GetError().c_str()}`)
  return result.Get()
}

/**
 * A drilled piece's collision as the EXACT hole-punched triangle mesh, so a ball
 * really drops through a bored plate. Built from the same manifold CSG the
 * renderer shows (`csgMeshSync`, piece-local triangles) → a Jolt `MeshShape`.
 *
 * MeshShapes are non-convex and Jolt only allows them on STATIC bodies, so this
 * is used for anchored pieces only; a dynamic drilled piece keeps its solid base
 * shape until convex decomposition lands (a later slice). Returns null when the
 * piece has no cuts, isn't drillable, or the CSG kernel hasn't loaded yet — in
 * which case the caller falls back to the solid shape and rebuilds on
 * `onCsgReady`.
 */
export function makeCutShape(Jolt: JoltModule, piece: Piece): any | null {
  const node = pieceToCsg(piece)
  if (!node) return null
  const mesh = csgMeshSync(node)
  if (!mesh) return null
  const { positions, indices } = mesh
  const verts = new Jolt.VertexList()
  for (let i = 0; i < positions.length; i += 3) {
    verts.push_back(new Jolt.Float3(positions[i], positions[i + 1], positions[i + 2]))
  }
  const tris = new Jolt.IndexedTriangleList()
  for (let i = 0; i < indices.length; i += 3) {
    tris.push_back(new Jolt.IndexedTriangle(indices[i], indices[i + 1], indices[i + 2], 0))
  }
  const settings = new Jolt.MeshShapeSettings(verts, tris, new Jolt.PhysicsMaterialList())
  const result = settings.Create()
  if (result.HasError()) throw new Error(`cut mesh: ${result.GetError().c_str()}`)
  return result.Get()
}

// Document dimensions are full extents; Jolt wants half-extents / radii.
export function makeShape(Jolt: JoltModule, primitive: Primitive, dims: Record<string, number>): any {
  switch (primitive) {
    case 'box': {
      const hx = dims.x / 2
      const hy = dims.y / 2
      const hz = dims.z / 2
      return new Jolt.BoxShape(new Jolt.Vec3(hx, hy, hz), edgeRadius(hx, hy, hz))
    }
    case 'cylinder':
      return new Jolt.CylinderShape(dims.height / 2, dims.radius, edgeRadius(dims.height / 2, dims.radius))
    case 'sphere':
      return new Jolt.SphereShape(dims.radius)
    case 'wedge': {
      // Right-triangular prism: base rectangle + top edge at x = -x/2.
      const settings = new Jolt.ConvexHullShapeSettings()
      const hx = dims.x / 2
      const hy = dims.y / 2
      const hz = dims.z / 2
      settings.mMaxConvexRadius = edgeRadius(hx, hy, hz)
      for (const [x, y, z] of [
        [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
        [-hx, hy, -hz], [-hx, hy, hz],
      ]) {
        settings.mPoints.push_back(new Jolt.Vec3(x, y, z))
      }
      const result = settings.Create()
      if (result.HasError()) throw new Error(`wedge hull: ${result.GetError().c_str()}`)
      return result.Get()
    }
    default: {
      const _exhaustive: never = primitive
      throw new Error(`unknown primitive: ${_exhaustive}`)
    }
  }
}
