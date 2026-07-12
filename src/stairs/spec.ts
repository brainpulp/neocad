/**
 * Parametric stair generator — the spec (parameter document). Pure data: no three,
 * no wasm, no React, no NeoCad document coupling, so the core stays standalone.
 *
 * The model is the WALKLINE: a stair is a walk along a path in plan, extruded up
 * one step at a time. `turns[]` splits the walk into flights; between flights the
 * walk either steps onto a flat LANDING (square/triangular descanso) and pivots,
 * or fans up a WINDER (a few wedge steps that both climb and turn). See the
 * stair-generator spec.
 *
 * Units are metres (NeoCad's world unit); the UI presents mm/cm for friendliness.
 * Ascends +Z (going), up +Y (rise), width centred on X. Turning 'right' rotates
 * the heading toward +X.
 */

/** Fix per-step rise and derive the step count, or fix the count and derive rise. */
export type StairSizing =
  | { mode: 'byRise'; targetRise: number }
  | { mode: 'byCount'; count: number }

export type TurnKind = 'landing' | 'winder'
/** A flat landing's footprint: a full square, or a triangle cutting the corner. */
export type LandingShape = 'square' | 'triangular'

export interface TurnSpec {
  id: string
  /** Turn magnitude in degrees (90 = quarter, 180 = half). */
  angle: number
  direction: 'left' | 'right'
  kind: TurnKind
  /** Landing footprint (kind === 'landing'). */
  landingShape: LandingShape
  /** Number of fanning wedge steps (kind === 'winder'); these DO climb. */
  winderSteps: number
}

/** The side members that carry the treads ("sidings"). */
export type StringerKind = 'none' | 'two-side' | 'mono'
export interface StringerSpec {
  kind: StringerKind
  /** Board thickness (two-side) / central beam width (mono), m. */
  thickness: number
  /** How far the stringer drops below the tread line, m. */
  depth: number
}

/** Handrail / balustrade. */
export type RailingSides = 'none' | 'left' | 'right' | 'both'
export interface RailingSpec {
  sides: RailingSides
  /** Handrail height above the nosing line (m). */
  height: number
  /** Newel post cross-section (m). */
  postSize: number
  /** Baluster (spindle) cross-section (m). */
  balusterSize: number
  /** Max clear gap between balusters (m); code ≈ 100 mm. */
  balusterGap: number
}

export interface StairSpec {
  /** Floor-to-floor height the stair must climb (m). */
  totalRise: number
  /** Stair width (m). */
  width: number
  /** Tread depth / horizontal run per step (m). */
  going: number
  /** Tread slab thickness (m). */
  treadThickness: number
  /** Tread overhang past the riser face, toward the climber (m). */
  nosing: number
  /** Closed risers fill the vertical face between treads; open leaves a gap. */
  riserMode: 'closed' | 'open'
  /** Closed-riser slab thickness (m). */
  riserThickness: number
  /** How the total rising-step count / per-step rise is chosen. */
  sizing: StairSizing
  /** Turns between flights, bottom → top. Empty = a single straight flight. */
  turns: TurnSpec[]
  /** Side stringers ("sidings"). */
  stringer: StringerSpec
  /** Handrail / balustrade. */
  railing: RailingSpec
  /** Wood/material name (for the cut list). */
  material: string
}

export function defaultStairSpec(): StairSpec {
  return {
    totalRise: 2.7,
    width: 1.0,
    going: 0.25,
    treadThickness: 0.04,
    nosing: 0.025,
    riserMode: 'closed',
    riserThickness: 0.02,
    sizing: { mode: 'byRise', targetRise: 0.18 },
    turns: [],
    stringer: { kind: 'two-side', thickness: 0.04, depth: 0.25 },
    railing: { sides: 'both', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
    material: 'pine',
  }
}

let turnSeq = 0
export function newTurn(partial: Partial<TurnSpec> = {}): TurnSpec {
  return {
    id: `turn_${++turnSeq}`,
    angle: 90,
    direction: 'right',
    kind: 'landing',
    landingShape: 'square',
    winderSteps: 3,
    ...partial,
  }
}
