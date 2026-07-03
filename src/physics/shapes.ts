import type { JoltModule } from './jolt'
import type { Primitive } from '../document/catalog'

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
