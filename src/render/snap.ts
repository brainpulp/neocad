import type { Vec3 } from '../document/types'

export const DEFAULT_SNAP = 0.1

/** Snap X and Z to a grid; leave Y (drop height) untouched. */
export function snapToGrid(pos: Vec3, size: number = DEFAULT_SNAP): Vec3 {
  if (size <= 0) return pos
  const q = (v: number) => Math.round(v / size) * size
  return [q(pos[0]), pos[1], q(pos[2])]
}
