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

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b))
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Quaternion product a * b (apply b first, then a). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** Shortest-arc rotation taking unit vector `from` onto unit vector `to`. */
export function quatFromTo(from: Vec3, to: Vec3): Quat {
  const f = normalize(from)
  const t = normalize(to)
  const d = dot(f, t)
  if (d > 1 - 1e-9) return [0, 0, 0, 1]
  if (d < -1 + 1e-9) {
    // Antiparallel: rotate 180° around any perpendicular.
    const [px, py, pz] = perpendicular(f)
    return [px, py, pz, 0]
  }
  const c = cross(f, t)
  const w = 1 + d
  const l = Math.hypot(c[0], c[1], c[2], w)
  return [c[0] / l, c[1] / l, c[2] / l, w / l]
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
