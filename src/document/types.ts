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
}

// Rigid fasteners only in M2. All compile to a Jolt fixed constraint and behave
// identically; they ship as distinct names because their strengths diverge once
// the failure/FEA evaluator arrives (spec §6b). Articulated fasteners + motors are M3.
export type FastenerType = 'weld' | 'glue' | 'bolt' | 'nail'

export interface Fastener {
  id: string
  type: FastenerType
  partA: string
  partB: string
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
    ground: { gravity: [0, -9.81, 0] },
  }
}
