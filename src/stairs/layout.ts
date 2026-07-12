/**
 * Stair layout — the brain. Pure arithmetic: a `StairSpec` in, a flat list of
 * geometry `Part`s + derived `metrics` + informational `advisories` out. No three,
 * no wasm — fully unit-testable, and cheap enough to re-run on every slider drag
 * (only the manifold meshing in build.ts costs anything).
 *
 * S0: a single straight flight of axis-aligned tread/riser boxes. Turns and winders
 * (which make parts oriented/trapezoidal) arrive in later slices.
 */
import type { StairSpec } from './spec'

/** An axis-aligned box part in stair-local space (centre + full-extent size, m). */
export interface Part {
  kind: 'tread' | 'riser'
  center: [number, number, number]
  size: [number, number, number]
}

export interface StairMetrics {
  /** Number of risers (equal-height, floor to floor). */
  risers: number
  /** Number of treads you step on (top step lands on the upper floor). */
  treads: number
  /** Per-step rise (m). */
  rise: number
  /** Per-step going / tread depth (m). */
  going: number
  /** Total horizontal run of the flight (m). */
  totalRun: number
  /** Pitch angle from horizontal (degrees). */
  pitchDeg: number
  /** Blondel comfort rule 2·rise + going (m); comfortable ≈ 0.55–0.70. */
  twoRplusG: number
}

export interface StairLayout {
  parts: Part[]
  metrics: StairMetrics
  /** Informational code notes (US IRC residential reference bands). Not pass/fail. */
  advisories: string[]
}

/** Resolve the sizing mode to a concrete riser count (≥ 2). */
export function riserCount(spec: StairSpec): number {
  if (spec.sizing.mode === 'byCount') return Math.max(2, Math.round(spec.sizing.count))
  const t = spec.sizing.targetRise
  if (!(t > 0)) return 2
  return Math.max(2, Math.round(spec.totalRise / t))
}

// US IRC residential reference bands (metres), informational for S0.
const IRC_MAX_RISE = 0.196 // 7¾"
const IRC_MIN_GOING = 0.254 // 10"
const IRC_MIN_WIDTH = 0.914 // 36"

function evaluateAdvisories(m: StairMetrics, width: number): string[] {
  const out: string[] = []
  const mm = (x: number) => Math.round(x * 1000)
  if (m.rise > IRC_MAX_RISE) out.push(`Rise ${mm(m.rise)} mm exceeds IRC max ${mm(IRC_MAX_RISE)} mm — steeper than code.`)
  if (m.going < IRC_MIN_GOING) out.push(`Going ${mm(m.going)} mm below IRC min ${mm(IRC_MIN_GOING)} mm — shallow treads.`)
  if (width < IRC_MIN_WIDTH) out.push(`Width ${mm(width)} mm below IRC min ${mm(IRC_MIN_WIDTH)} mm.`)
  if (m.twoRplusG < 0.55 || m.twoRplusG > 0.7)
    out.push(`2R+G ${mm(m.twoRplusG)} mm outside the comfortable 550–700 mm range.`)
  return out
}

export function layoutStair(spec: StairSpec): StairLayout {
  const N = riserCount(spec)
  const rise = spec.totalRise / N
  const G = spec.going
  const W = spec.width
  const Tt = spec.treadThickness
  const Tr = spec.riserThickness
  const No = spec.nosing
  const treads = N - 1

  const parts: Part[] = []
  for (let k = 1; k <= N; k++) {
    // Riser k: the vertical face at z=(k-1)·G, rising from (k-1)·rise to k·rise.
    if (spec.riserMode === 'closed') {
      const zFace = (k - 1) * G
      parts.push({
        kind: 'riser',
        center: [0, (k - 1) * rise + rise / 2, zFace + Tr / 2],
        size: [W, rise, Tr],
      })
    }
  }
  for (let k = 1; k <= treads; k++) {
    // Tread k: top surface at y=k·rise, overhanging the riser face by `nosing` in
    // front (−z) and running back to the next riser at z=k·G.
    const front = (k - 1) * G - No
    const back = k * G
    parts.push({
      kind: 'tread',
      center: [0, k * rise - Tt / 2, (front + back) / 2],
      size: [W, Tt, back - front],
    })
  }

  const totalRun = (N - 1) * G
  const metrics: StairMetrics = {
    risers: N,
    treads,
    rise,
    going: G,
    totalRun,
    pitchDeg: (Math.atan2(rise, G) * 180) / Math.PI,
    twoRplusG: 2 * rise + G,
  }
  return { parts, metrics, advisories: evaluateAdvisories(metrics, W) }
}
