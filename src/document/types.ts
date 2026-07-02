export const CURRENT_VERSION = 1

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface Transform {
  position: Vec3
  rotation: Quat
}

export interface Material {
  name: string
  density: number
  friction: number
  restitution: number
  color: string
  // Reserved for the future FEA/failure evaluator. Unused by the M1 rigid-body sim,
  // declared now so adding the evaluator needs no document migration (spec §6c).
  youngsModulus?: number
  yieldStrength?: number
  poissonRatio?: number
}

export type StockType =
  | 'rod'
  | 'tube'
  | 'dowel'
  | 'slat'
  | 'joist'
  | 'panel'
  | 'block'
  | 'ball'
  // Mechanical stock: all collide as cylinders for now; teeth/grooves are visual.
  | 'gear'
  | 'pinion'
  | 'axle'
  | 'pin'
  | 'pulley'
  | 'cam'
  | 'ratchet'

export interface Piece {
  id: string
  name: string
  stockType: StockType
  /** Shape-specific dimensions (full extents): box {x,y,z}, cylinder {radius,height}, sphere {radius}. */
  dimensions: Record<string, number>
  /** Reference into the document's materials table by name. */
  material: string
  /** Stable rest placement (the user's intent). */
  definition: { transform: Transform }
  /** Live pose, advanced by physics, frozen on pause, persisted on save. */
  state: { transform: Transform }
  anchored: boolean
}

export interface Ground {
  gravity: Vec3
  /**
   * The workbench: a visible square slab where the action happens. Invisible
   * walls at its edge keep physics from throwing pieces off into the distance;
   * paused (user) moves are unaffected.
   */
  sandbox?: { size: number; thickness: number }
}

export const DEFAULT_SANDBOX = { size: 4, thickness: 0.05 }

// Rigid fasteners compile to a Jolt fixed constraint and behave identically; they
// ship as distinct names because their strengths diverge once the failure/FEA
// evaluator arrives (spec §6b).
export type RigidFastenerType = 'weld' | 'glue' | 'bolt' | 'nail'
// Articulated joints, placed point-A → type → point-B with the Joint tool.
// pivot = rotates around the axis; linear = slides along it; cylindrical = both.
export type JointType = 'pivot' | 'cylindrical' | 'linear'
export type FastenerType = RigidFastenerType | JointType

export const JOINT_TYPES: JointType[] = ['pivot', 'cylindrical', 'linear']
export function isJointType(t: FastenerType): t is JointType {
  return (JOINT_TYPES as FastenerType[]).includes(t)
}

export interface Fastener {
  id: string
  type: FastenerType
  partA: string
  partB: string
  /** Joint anchor in partA's local frame (joints only; rigid fasteners auto-detect). */
  anchorA?: Vec3
  /** Joint anchor in partB's local frame (joints only). */
  anchorB?: Vec3
  /** Joint axis in partA's local frame (joints only). */
  axisA?: Vec3
  /**
   * Slide range along the axis for linear/cylindrical joints (meters, relative
   * to the anchors' initial coincidence). Keeps a gear from sliding off the end
   * of its axle — real shafts have ends.
   */
  slideMin?: number
  slideMax?: number
}

export interface Document {
  version: number
  metadata: { name: string }
  materials: Material[]
  pieces: Piece[]
  fasteners: Fastener[]
  ground: Ground
  camera?: unknown
}

export const DEFAULT_MATERIALS: Material[] = [
  { name: 'steel', density: 7850, friction: 0.4, restitution: 0.1, color: '#8a8f98' },
  { name: 'aluminum', density: 2700, friction: 0.4, restitution: 0.1, color: '#c9cdd3' },
  { name: 'wood', density: 500, friction: 0.5, restitution: 0.2, color: '#b3854a' },
  { name: 'plastic', density: 1200, friction: 0.3, restitution: 0.3, color: '#3b82c4' },
  { name: 'rubber', density: 1100, friction: 0.9, restitution: 0.8, color: '#2b2b2b' },
]

export function emptyDocument(): Document {
  return {
    version: CURRENT_VERSION,
    metadata: { name: 'Untitled' },
    materials: structuredClone(DEFAULT_MATERIALS),
    pieces: [],
    fasteners: [],
    ground: { gravity: [0, -9.81, 0], sandbox: { ...DEFAULT_SANDBOX } },
  }
}
