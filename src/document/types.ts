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
  | 'wedge'

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
// pivot = rotates around the axis; linear = slides along it; cylindrical = both;
// spring = elastic tether between the two points (stiffness + damping).
export type JointType = 'pivot' | 'cylindrical' | 'linear' | 'spring'
export type FastenerType = RigidFastenerType | JointType

export const JOINT_TYPES: JointType[] = ['pivot', 'cylindrical', 'linear', 'spring']
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
  /**
   * Drive the joint: pivots get a rotational motor (velocity in rad/s, torque
   * limit in N·m), linear joints a linear one (velocity m/s, force N).
   */
  motor?: { enabled: boolean; velocity: number; maxForce: number }
  /** Spring joints: stiffness (Hz), damping ratio, and rest length (m). */
  spring?: { frequency: number; damping: number; restLength: number }
  /** Pivot swing limits (radians), e.g. a gate that only opens 90°. */
  angleMin?: number
  angleMax?: number
  /** Cylindrical joints: each freedom can be switched off in the inspector. */
  canSpin?: boolean
  canSlide?: boolean
}

/** A rope end tied to a piece (anchor in that piece's local frame). */
export interface RopeAttachment {
  pieceId: string
  anchor: Vec3
}

/**
 * A rope: simulated as a Jolt soft body (particle chain). Rest geometry +
 * parameters live here; the live particle positions are evaluation state and
 * are never persisted (Reset regenerates the rope from this definition).
 */
export interface Rope {
  id: string
  name: string
  /** World rest endpoints (used when an end isn't attached). */
  start: Vec3
  end: Vec3
  segments: number
  radius: number
  /** Rest-length multiplier: 1 = taut line, >1 hangs slack. */
  slack: number
  /** 0..1 — how hard the rope resists stretching. */
  stiffness: number
  /** Closed loop (belt) instead of an open strand. */
  looped: boolean
  attachStart?: RopeAttachment | null
  attachEnd?: RopeAttachment | null
  material: string
}

export interface Document {
  version: number
  metadata: { name: string }
  materials: Material[]
  pieces: Piece[]
  fasteners: Fastener[]
  ropes: Rope[]
  ground: Ground
  camera?: unknown
}

// The workshop material library: honest densities (kg/m³), friction and
// restitution. Rigid-body only for now — glass/ceramic are rigid but flagged
// brittle for the future failure evaluator (spec §6c).
export const DEFAULT_MATERIALS: Material[] = [
  // Woods
  { name: 'pine', density: 450, friction: 0.5, restitution: 0.2, color: '#c9a36a' },
  { name: 'oak', density: 720, friction: 0.5, restitution: 0.18, color: '#a87d47' },
  { name: 'walnut', density: 650, friction: 0.48, restitution: 0.18, color: '#6b4a2f' },
  { name: 'plywood', density: 550, friction: 0.5, restitution: 0.2, color: '#d3b184' },
  { name: 'mdf', density: 750, friction: 0.55, restitution: 0.15, color: '#c8ab7e' },
  { name: 'bamboo', density: 700, friction: 0.45, restitution: 0.25, color: '#d6c087' },
  { name: 'cork', density: 240, friction: 0.7, restitution: 0.3, color: '#c99e63' },
  { name: 'wood', density: 500, friction: 0.5, restitution: 0.2, color: '#b3854a' },
  // Rubbers
  { name: 'rubber-soft', density: 950, friction: 1.0, restitution: 0.85, color: '#3a3a3e' },
  { name: 'rubber-hard', density: 1200, friction: 0.85, restitution: 0.6, color: '#2b2b2b' },
  { name: 'rubber-tire', density: 1100, friction: 0.95, restitution: 0.7, color: '#1e1e22' },
  { name: 'rubber', density: 1100, friction: 0.9, restitution: 0.8, color: '#2b2b2b' },
  // Plastics
  { name: 'plastic-abs', density: 1050, friction: 0.35, restitution: 0.3, color: '#e8b23a' },
  { name: 'plastic-acrylic', density: 1180, friction: 0.3, restitution: 0.25, color: '#7fd0e8' },
  { name: 'plastic-nylon', density: 1140, friction: 0.25, restitution: 0.3, color: '#e8e4da' },
  { name: 'plastic', density: 1200, friction: 0.3, restitution: 0.3, color: '#3b82c4' },
  { name: 'foam', density: 60, friction: 0.8, restitution: 0.4, color: '#eef0d8' },
  // Metals
  { name: 'steel', density: 7850, friction: 0.4, restitution: 0.1, color: '#8a8f98' },
  { name: 'aluminum', density: 2700, friction: 0.4, restitution: 0.1, color: '#c9cdd3' },
  { name: 'brass', density: 8500, friction: 0.35, restitution: 0.1, color: '#c9a53e' },
  { name: 'copper', density: 8960, friction: 0.35, restitution: 0.1, color: '#c07347' },
  { name: 'cast-iron', density: 7200, friction: 0.45, restitution: 0.08, color: '#4c4f54' },
  { name: 'titanium', density: 4500, friction: 0.38, restitution: 0.1, color: '#a6adb8' },
  { name: 'lead', density: 11340, friction: 0.5, restitution: 0.03, color: '#5a5f6a' },
  // Mineral & brittle (rigid for now; the failure evaluator makes these breakable)
  { name: 'glass', density: 2500, friction: 0.5, restitution: 0.05, color: '#bcd8e2', youngsModulus: 70e9, yieldStrength: 33e6 },
  { name: 'ceramic', density: 2400, friction: 0.6, restitution: 0.05, color: '#e8e3dc', youngsModulus: 300e9, yieldStrength: 25e6 },
  { name: 'concrete', density: 2400, friction: 0.8, restitution: 0.05, color: '#9b9c96' },
  { name: 'brick', density: 1900, friction: 0.75, restitution: 0.05, color: '#a85a42' },
  { name: 'granite', density: 2700, friction: 0.65, restitution: 0.08, color: '#75777c' },
  { name: 'marble', density: 2700, friction: 0.5, restitution: 0.08, color: '#d9d7d2' },
  { name: 'ice', density: 917, friction: 0.03, restitution: 0.05, color: '#cfe8f5' },
  { name: 'cardboard', density: 250, friction: 0.6, restitution: 0.15, color: '#b98f5c' },
  { name: 'hemp', density: 900, friction: 0.6, restitution: 0.1, color: '#b09468' },
]

export function emptyDocument(): Document {
  return {
    version: CURRENT_VERSION,
    metadata: { name: 'Untitled' },
    materials: structuredClone(DEFAULT_MATERIALS),
    pieces: [],
    fasteners: [],
    ropes: [],
    ground: { gravity: [0, -9.81, 0], sandbox: { ...DEFAULT_SANDBOX } },
  }
}
