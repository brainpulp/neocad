import type { JoltModule } from './jolt'
import type { Primitive } from '../document/catalog'

// Document dimensions are full extents; Jolt wants half-extents / radii.
// Convex radius 0 keeps thin stock (e.g. a 12mm slat) from tripping Jolt's
// default convex radius assertion.
export function makeShape(Jolt: JoltModule, primitive: Primitive, dims: Record<string, number>): any {
  switch (primitive) {
    case 'box':
      return new Jolt.BoxShape(new Jolt.Vec3(dims.x / 2, dims.y / 2, dims.z / 2), 0.0)
    case 'cylinder':
      return new Jolt.CylinderShape(dims.height / 2, dims.radius, 0.0)
    case 'sphere':
      return new Jolt.SphereShape(dims.radius)
    case 'wedge': {
      // Right-triangular prism: base rectangle + top edge at x = -x/2.
      const settings = new Jolt.ConvexHullShapeSettings()
      const hx = dims.x / 2
      const hy = dims.y / 2
      const hz = dims.z / 2
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
