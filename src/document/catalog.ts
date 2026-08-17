import { hollowVolume } from './hollow'
import type { FastenerType, Piece, StockType, Vec3 } from './types'

export type Primitive = 'box' | 'cylinder' | 'sphere' | 'wedge'

// Custom visual shapes for mechanical stock; they still collide as their Primitive.
export type VisualKind = 'gear' | 'pulley' | 'cam' | 'ratchet'

// Rigid fasteners map to 'fixed'; joints map to articulated constraints.
// M3 adds ball | rope.
export type ConstraintKind = 'fixed' | 'hinge' | 'slider' | 'cylindrical' | 'distance'

export interface FastenerDef {
  label: string
  constraint: ConstraintKind
  /** Short builder-facing description, shown in pickers. */
  hint?: string
  /** Bond strength (N): the join BREAKS past this force. Undefined = unbreakable. */
  strength?: number
}

// User-facing real-world fastener → hidden engine constraint (spec §6b).
// Rigid bonds have honest relative strengths: a weld outlasts a nail.
export const FASTENERS: Record<FastenerType, FastenerDef> = {
  weld: { label: 'Weld', constraint: 'fixed', hint: 'permanent rigid join', strength: 9000 },
  glue: { label: 'Glue', constraint: 'fixed', hint: 'rigid join', strength: 1200 },
  bolt: { label: 'Bolt', constraint: 'fixed', hint: 'rigid, removable', strength: 6000 },
  nail: { label: 'Nail', constraint: 'fixed', hint: 'rigid, quick', strength: 2000 },
  // Maker vocabulary (Tinkercad's): the schema ids stay pivot/cylindrical/linear
  // for document compatibility — only the labels speak hardware.
  pivot: { label: 'Hinge', constraint: 'hinge', hint: 'swings around the axis, like a door hinge' },
  cylindrical: { label: 'Axle', constraint: 'cylindrical', hint: 'spins like a shaft in a bearing (sliding optional)' },
  linear: { label: 'Slider', constraint: 'slider', hint: 'slides along a rail, like a drawer' },
  spring: { label: 'Spring', constraint: 'distance', hint: 'elastic tether — stiffness & damping' },
}

export const RIGID_FASTENER_TYPES: FastenerType[] = ['weld', 'glue', 'bolt', 'nail']

export type StockGroup = 'stock' | 'mechanical'

export interface StockDef {
  label: string
  primitive: Primitive
  /** Default full-extent dimensions for this stock. */
  defaultDimensions: Record<string, number>
  defaultMaterial: string
  group: StockGroup
  /** Custom render geometry; physics still uses `primitive`. */
  visual?: VisualKind
}

// User-facing real-world stock → hidden engine primitive (spec §6b).
// The StockType union enforces completeness.
export const STOCK: Record<StockType, StockDef> = {
  rod: { label: 'Rod', primitive: 'cylinder', defaultDimensions: { radius: 0.05, height: 1.0 }, defaultMaterial: 'steel', group: 'stock' },
  tube: { label: 'Tube', primitive: 'cylinder', defaultDimensions: { radius: 0.06, height: 1.0 }, defaultMaterial: 'aluminum', group: 'stock' },
  dowel: { label: 'Dowel', primitive: 'cylinder', defaultDimensions: { radius: 0.02, height: 0.5 }, defaultMaterial: 'wood', group: 'stock' },
  slat: { label: 'Slat', primitive: 'box', defaultDimensions: { x: 0.6, y: 0.012, z: 0.1 }, defaultMaterial: 'wood', group: 'stock' },
  joist: { label: 'Joist', primitive: 'box', defaultDimensions: { x: 0.09, y: 0.04, z: 1.2 }, defaultMaterial: 'wood', group: 'stock' },
  panel: { label: 'Panel', primitive: 'box', defaultDimensions: { x: 1.2, y: 0.02, z: 0.6 }, defaultMaterial: 'wood', group: 'stock' },
  block: { label: 'Block', primitive: 'box', defaultDimensions: { x: 0.3, y: 0.3, z: 0.3 }, defaultMaterial: 'wood', group: 'stock' },
  ball: { label: 'Ball', primitive: 'sphere', defaultDimensions: { radius: 0.15 }, defaultMaterial: 'rubber', group: 'stock' },
  // Right-triangular prism: the ramp. Slope rises along +x, apex edge along z.
  wedge: { label: 'Wedge', primitive: 'wedge', defaultDimensions: { x: 0.4, y: 0.2, z: 0.3 }, defaultMaterial: 'wood', group: 'stock' },
  // Mechanical stock. Teeth/grooves/lobes are visual for now; all collide as
  // cylinders (radius × height), which is right for axles/pins/dowels and an
  // acceptable approximation for toothed parts until gear-mesh physics lands.
  gear: { label: 'Gear', primitive: 'cylinder', defaultDimensions: { radius: 0.12, height: 0.024, teeth: 16 }, defaultMaterial: 'plastic', group: 'mechanical', visual: 'gear' },
  pinion: { label: 'Pinion', primitive: 'cylinder', defaultDimensions: { radius: 0.05, height: 0.024, teeth: 10 }, defaultMaterial: 'plastic', group: 'mechanical', visual: 'gear' },
  ratchet: { label: 'Ratchet', primitive: 'cylinder', defaultDimensions: { radius: 0.1, height: 0.02, teeth: 12 }, defaultMaterial: 'steel', group: 'mechanical', visual: 'ratchet' },
  cam: { label: 'Cam', primitive: 'cylinder', defaultDimensions: { radius: 0.06, height: 0.02, lobe: 0.03 }, defaultMaterial: 'steel', group: 'mechanical', visual: 'cam' },
  pulley: { label: 'Pulley', primitive: 'cylinder', defaultDimensions: { radius: 0.08, height: 0.03 }, defaultMaterial: 'plastic', group: 'mechanical', visual: 'pulley' },
  axle: { label: 'Axle', primitive: 'cylinder', defaultDimensions: { radius: 0.015, height: 0.6 }, defaultMaterial: 'steel', group: 'mechanical' },
  pin: { label: 'Pin', primitive: 'cylinder', defaultDimensions: { radius: 0.008, height: 0.08 }, defaultMaterial: 'steel', group: 'mechanical' },
}

export const STOCK_GROUPS: { group: StockGroup; label: string }[] = [
  { group: 'stock', label: 'STOCK' },
  { group: 'mechanical', label: 'MECHANICAL' },
]

/** Volume (m³) of a piece's collision primitive (walls only, if hollowed). */
export function pieceVolume(piece: Piece): number {
  if (piece.hollow) {
    // Wall volume from the shared brick decomposition (0 if not hollowable).
    const walls = hollowVolume(piece)
    if (walls > 0) return walls
  }
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return d.x * d.y * d.z
    case 'cylinder':
      return Math.PI * d.radius * d.radius * d.height
    case 'sphere':
      return (4 / 3) * Math.PI * d.radius ** 3
    case 'wedge':
      return (d.x * d.y * d.z) / 2
  }
}

/** Real mass (kg) from material density × volume. */
export function pieceMass(piece: Piece, materials: { name: string; density: number }[]): number {
  const density = materials.find((m) => m.name === piece.material)?.density ?? 1000
  return Math.max(0.001, density * pieceVolume(piece))
}

/** Builder-friendly weight: grams under a kilo, one decimal of kg above. */
export function formatMass(kg: number): string {
  if (kg < 0.995) return `${Math.round(kg * 1000)} g`
  if (kg < 100) return `${kg.toFixed(1)} kg`
  return `${Math.round(kg)} kg`
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${idCounter}`
}

let fastenerCounter = 0
export function nextFastenerId(): string {
  fastenerCounter += 1
  return `f_${fastenerCounter}`
}

export function makePiece(stockType: StockType, position: Vec3): Piece {
  const def = STOCK[stockType]
  const transform = { position, rotation: [0, 0, 0, 1] as [number, number, number, number] }
  return {
    id: nextId(stockType),
    name: def.label,
    stockType,
    dimensions: { ...def.defaultDimensions },
    material: def.defaultMaterial,
    definition: { transform: { position: [...position], rotation: [0, 0, 0, 1] } },
    state: { transform: { position: [...position], rotation: [...transform.rotation] } },
    anchored: false,
  }
}
