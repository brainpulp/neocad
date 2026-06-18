import type { FastenerType, Piece, StockType, Vec3 } from './types'

export type Primitive = 'box' | 'cylinder' | 'sphere'

// M2 ships only rigid fasteners; all map to the 'fixed' constraint. M3 adds
// revolute | prismatic | ball | rope.
export type ConstraintKind = 'fixed'

export interface FastenerDef {
  label: string
  constraint: ConstraintKind
}

// User-facing real-world fastener → hidden engine constraint (spec §6b).
export const FASTENERS: Record<FastenerType, FastenerDef> = {
  weld: { label: 'Weld', constraint: 'fixed' },
  glue: { label: 'Glue', constraint: 'fixed' },
  bolt: { label: 'Bolt', constraint: 'fixed' },
  nail: { label: 'Nail', constraint: 'fixed' },
}

export interface StockDef {
  label: string
  primitive: Primitive
  /** Default full-extent dimensions for this stock. */
  defaultDimensions: Record<string, number>
  defaultMaterial: string
}

// User-facing real-world stock → hidden engine primitive (spec §6b).
// All 8 stock types are required; the StockType union enforces completeness.
export const STOCK: Record<StockType, StockDef> = {
  rod: { label: 'Rod', primitive: 'cylinder', defaultDimensions: { radius: 0.05, height: 1.0 }, defaultMaterial: 'steel' },
  tube: { label: 'Tube', primitive: 'cylinder', defaultDimensions: { radius: 0.06, height: 1.0 }, defaultMaterial: 'aluminum' },
  dowel: { label: 'Dowel', primitive: 'cylinder', defaultDimensions: { radius: 0.02, height: 0.5 }, defaultMaterial: 'wood' },
  slat: { label: 'Slat', primitive: 'box', defaultDimensions: { x: 0.6, y: 0.012, z: 0.1 }, defaultMaterial: 'wood' },
  joist: { label: 'Joist', primitive: 'box', defaultDimensions: { x: 0.09, y: 0.04, z: 1.2 }, defaultMaterial: 'wood' },
  panel: { label: 'Panel', primitive: 'box', defaultDimensions: { x: 1.2, y: 0.02, z: 0.6 }, defaultMaterial: 'wood' },
  block: { label: 'Block', primitive: 'box', defaultDimensions: { x: 0.3, y: 0.3, z: 0.3 }, defaultMaterial: 'wood' },
  ball: { label: 'Ball', primitive: 'sphere', defaultDimensions: { radius: 0.15 }, defaultMaterial: 'rubber' },
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${idCounter}`
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
