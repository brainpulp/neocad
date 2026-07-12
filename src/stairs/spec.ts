/**
 * Parametric stair generator — the spec (parameter document). Pure data: no three,
 * no wasm, no React, no NeoCad document coupling, so the core stays standalone.
 *
 * The model is the WALKLINE: a stair is a walk along a path in plan, extruded up
 * one step at a time. S0 is a single straight flight; turns/winders/spiral arrive
 * as a `flights: Segment[]` path in later slices. See the stair-generator spec.
 *
 * Units are metres (NeoCad's world unit); the UI presents mm/cm for friendliness.
 * Ascends +Z (going), up +Y (rise), width centred on X.
 */

/** Fix per-step rise and derive the step count, or fix the count and derive rise. */
export type StairSizing =
  | { mode: 'byRise'; targetRise: number }
  | { mode: 'byCount'; count: number }

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
  /** How the step count / per-step rise is chosen. */
  sizing: StairSizing
}

export function defaultStairSpec(): StairSpec {
  return {
    totalRise: 2.7, // a typical residential floor-to-floor
    width: 1.0,
    going: 0.25,
    treadThickness: 0.04,
    nosing: 0.025,
    riserMode: 'closed',
    riserThickness: 0.02,
    sizing: { mode: 'byRise', targetRise: 0.18 },
  }
}
