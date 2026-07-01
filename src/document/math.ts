import type { Quat, Transform, Vec3 } from './types'

/** Minimal vector/quaternion helpers for the document layer (kept three-free). */

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function normalize(v: Vec3): Vec3 {
  const l = length(v)
  if (l < 1e-9) return [0, 1, 0]
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Any unit vector perpendicular to v (v need not be normalized). */
export function perpendicular(v: Vec3): Vec3 {
  const [x, y, z] = normalize(v)
  // Cross with the world axis least aligned with v to avoid degeneracy.
  const ref: Vec3 = Math.abs(y) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  return normalize([y * ref[2] - z * ref[1], z * ref[0] - x * ref[2], x * ref[1] - y * ref[0]])
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  // v' = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

/** World point → the local frame of a transform. */
export function worldToLocal(t: Transform, world: Vec3): Vec3 {
  return quatRotate(quatConjugate(t.rotation), sub(world, t.position))
}

/** Local point → world via a transform. */
export function localToWorld(t: Transform, local: Vec3): Vec3 {
  const r = quatRotate(t.rotation, local)
  return [r[0] + t.position[0], r[1] + t.position[1], r[2] + t.position[2]]
}

/** World direction → the local frame of a transform (rotation only). */
export function worldDirToLocal(t: Transform, dir: Vec3): Vec3 {
  return quatRotate(quatConjugate(t.rotation), dir)
}

/** Local direction → world (rotation only). */
export function localDirToWorld(t: Transform, dir: Vec3): Vec3 {
  return quatRotate(t.rotation, dir)
}
