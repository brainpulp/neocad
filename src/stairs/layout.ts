/**
 * Stair layout — the brain. Pure arithmetic: a `StairSpec` in, a flat list of
 * geometry `Part`s + derived `metrics` + informational `advisories` out. No three,
 * no wasm — fully unit-testable, and cheap enough to re-run on every slider drag
 * (only the manifold meshing in build.ts costs anything).
 *
 * The walk: total rising steps N (equal risers) split across `turns.length + 1`
 * flights. Between flights a LANDING (flat, 0 risers, pivots the heading) or a
 * WINDER (w wedge steps that climb AND turn). Parts are boxes (yawed about Y,
 * optionally pitched for stringers) or vertical prisms (triangular landings,
 * winder wedges).
 */
import type { StairSpec, TurnSpec } from './spec'

type Vec3 = [number, number, number]
export type PartKind = 'tread' | 'riser' | 'landing' | 'stringer'

export type Part =
  | { kind: PartKind; shape: 'box'; center: Vec3; size: Vec3; rotYDeg: number; pitchDeg?: number }
  | { kind: PartKind; shape: 'prism'; polygon: [number, number][]; bottom: number; top: number }

export interface StairMetrics {
  risers: number
  treads: number
  rise: number
  going: number
  totalRun: number
  pitchDeg: number
  twoRplusG: number
  flights: number[]
}

export interface StairLayout {
  parts: Part[]
  metrics: StairMetrics
  advisories: string[]
}

// ---- plan-space (XZ) helpers -----------------------------------------------
const DEG = Math.PI / 180
/** Unit forward direction for a heading θ (deg): θ=0 → +Z, right turn → +X. */
function forward(theta: number): Vec3 {
  return [Math.sin(theta * DEG), 0, Math.cos(theta * DEG)]
}
/** Unit "right" (lateral) direction: θ=0 → +X. */
function right(theta: number): Vec3 {
  return [Math.cos(theta * DEG), 0, -Math.sin(theta * DEG)]
}
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
/** Rotate a plan point (x,z) about pivot (px,pz) by `deg` (right/+ = toward +X). */
function rotAbout(x: number, z: number, px: number, pz: number, deg: number): [number, number] {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  const dx = x - px
  const dz = z - pz
  return [px + dx * c + dz * s, pz - dx * s + dz * c]
}
function signedArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}
/** Manifold's extruder fills CCW; return the polygon wound CCW in the (x,z) plane. */
function ensureCCW(poly: [number, number][]): [number, number][] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

// ---- sizing ----------------------------------------------------------------
export function riserCount(spec: StairSpec): number {
  if (spec.sizing.mode === 'byCount') return Math.max(2, Math.round(spec.sizing.count))
  const t = spec.sizing.targetRise
  if (!(t > 0)) return 2
  return Math.max(2, Math.round(spec.totalRise / t))
}

/** Split the straight (non-winder) steps across `flightCount` flights, evenly. */
function splitFlights(straightSteps: number, flightCount: number): number[] {
  const base = Math.floor(straightSteps / flightCount)
  const rem = straightSteps - base * flightCount
  return Array.from({ length: flightCount }, (_, i) => base + (i < rem ? 1 : 0))
}

// US IRC residential reference bands (metres), informational.
const IRC_MAX_RISE = 0.196
const IRC_MIN_GOING = 0.254
const IRC_MIN_WIDTH = 0.914

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

// ---- the walk --------------------------------------------------------------
interface Walk {
  pos: Vec3
  heading: number
  climbed: number
}

export function layoutStair(spec: StairSpec): StairLayout {
  const N = riserCount(spec)
  const rise = spec.totalRise / N
  const G = spec.going
  const W = spec.width
  const Tt = spec.treadThickness
  const Tr = spec.riserThickness
  const No = spec.nosing
  const turns = spec.turns
  const flightCount = turns.length + 1
  const winderTotal = turns.reduce((s, t) => s + (t.kind === 'winder' ? Math.max(1, t.winderSteps) : 0), 0)
  const straightSteps = Math.max(flightCount, N - winderTotal)
  const flights = splitFlights(straightSteps, flightCount)

  const parts: Part[] = []
  const walk: Walk = { pos: [0, 0, 0], heading: 0, climbed: 0 }

  const emitStraightFlight = (steps: number, toppedByLanding: boolean) => {
    const f = forward(walk.heading)
    const base = walk.pos
    for (let k = 1; k <= steps; k++) {
      const globalStep = walk.climbed + k
      const isFloorTop = globalStep === N
      if (spec.riserMode === 'closed') {
        const along = (k - 1) * G + Tr / 2
        const c = add(base, scale(f, along))
        parts.push({ kind: 'riser', shape: 'box', center: [c[0], base[1] + (k - 1) * rise + rise / 2, c[2]], size: [W, rise, Tr], rotYDeg: walk.heading })
      }
      const isFlightTop = k === steps
      if (!isFloorTop && !(isFlightTop && toppedByLanding)) {
        const along = ((2 * k - 1) * G - No) / 2
        const c = add(base, scale(f, along))
        parts.push({ kind: 'tread', shape: 'box', center: [c[0], base[1] + k * rise - Tt / 2, c[2]], size: [W, Tt, G + No], rotYDeg: walk.heading })
      }
    }
    emitFlightStringers(parts, spec, base, walk.heading, steps, rise)
    walk.pos = add(add(base, [0, steps * rise, 0]), scale(f, steps * G))
    walk.climbed += steps
  }

  const emitLanding = (t: TurnSpec) => {
    const s = t.direction === 'right' ? 1 : -1
    const A = walk.pos
    const top = A[1]
    const f = forward(walk.heading)
    const r = right(walk.heading)
    const half = W / 2
    if (Math.abs(t.angle) >= 180) {
      // Half-turn: a 2W×W rectangle bridging two antiparallel flights offset by W.
      const center = add(add(A, scale(f, half)), scale(r, s * half))
      parts.push({ kind: 'landing', shape: 'box', center: [center[0], top - Tt / 2, center[2]], size: [2 * W, Tt, W], rotYDeg: walk.heading })
      walk.pos = [A[0] + r[0] * s * W + f[0] * W, top, A[2] + r[2] * s * W + f[2] * W]
      walk.heading += s * t.angle
      return
    }
    const entryOuter = add(A, scale(r, -s * half))
    const entryInner = add(A, scale(r, s * half))
    const farInner = add(entryInner, scale(f, W))
    if (t.landingShape === 'triangular') {
      parts.push({
        kind: 'landing',
        shape: 'prism',
        polygon: ensureCCW([
          [entryOuter[0], entryOuter[2]],
          [entryInner[0], entryInner[2]],
          [farInner[0], farInner[2]],
        ]),
        bottom: top - Tt,
        top,
      })
    } else {
      const center = add(A, scale(f, half))
      parts.push({ kind: 'landing', shape: 'box', center: [center[0], top - Tt / 2, center[2]], size: [W, Tt, W], rotYDeg: walk.heading })
    }
    const exit = add(entryInner, scale(forward(walk.heading + s * t.angle), half))
    walk.pos = [exit[0], top, exit[2]]
    walk.heading += s * t.angle
  }

  const emitWinder = (t: TurnSpec) => {
    const s = t.direction === 'right' ? 1 : -1
    const w = Math.max(1, t.winderSteps)
    const per = t.angle / w
    const A = walk.pos
    const start = walk.heading
    const r0 = right(start)
    // Pivot at the inner walkline edge (a newel post); winder treads are kites
    // with their apex at the pivot, fanning to the outer edge (radius W).
    const pivot: Vec3 = [A[0] + r0[0] * s * (W / 2), A[1], A[2] + r0[2] * s * (W / 2)]
    const eOuter = add(A, scale(r0, -s * (W / 2)))
    for (let i = 1; i <= w; i++) {
      const [ox0, oz0] = rotAbout(eOuter[0], eOuter[2], pivot[0], pivot[2], s * per * (i - 1))
      const [ox1, oz1] = rotAbout(eOuter[0], eOuter[2], pivot[0], pivot[2], s * per * i)
      const top = A[1] + i * rise
      parts.push({
        kind: 'tread',
        shape: 'prism',
        polygon: ensureCCW([
          [pivot[0], pivot[2]],
          [ox0, oz0],
          [ox1, oz1],
        ]),
        bottom: top - Tt,
        top,
      })
    }
    const [mx, mz] = rotAbout(A[0], A[2], pivot[0], pivot[2], s * t.angle)
    walk.pos = [mx, A[1] + w * rise, mz]
    walk.heading = start + s * t.angle
    walk.climbed += w
  }

  for (let fi = 0; fi < flightCount; fi++) {
    const nextTurn = fi < turns.length ? turns[fi] : null
    emitStraightFlight(flights[fi], nextTurn?.kind === 'landing')
    if (nextTurn) {
      if (nextTurn.kind === 'landing') emitLanding(nextTurn)
      else emitWinder(nextTurn)
    }
  }

  const totalRun = (N - 1) * G
  const metrics: StairMetrics = {
    risers: N,
    treads: parts.filter((p) => p.kind === 'tread').length,
    rise,
    going: G,
    totalRun,
    pitchDeg: (Math.atan2(rise, G) * 180) / Math.PI,
    twoRplusG: 2 * rise + G,
    flights,
  }
  return { parts, metrics, advisories: evaluateAdvisories(metrics, W) }
}

// ---- stringers ("sidings") -------------------------------------------------
/**
 * Raked side boards (two-side) or one central beam (mono) under a straight flight,
 * dropped `depth` below the tread line. A box the length of the rake, pitched to
 * the flight slope and yawed to the heading. Winder/landing stringers are a later
 * refinement.
 */
function emitFlightStringers(parts: Part[], spec: StairSpec, base: Vec3, heading: number, steps: number, rise: number) {
  if (spec.stringer.kind === 'none' || steps <= 0) return
  const f = forward(heading)
  const r = right(heading)
  const G = spec.going
  const depth = spec.stringer.depth
  const th = spec.stringer.thickness
  const run = steps * G
  const climb = steps * rise
  const hyp = Math.hypot(run, climb)
  const pitchDeg = (Math.atan2(climb, run) * 180) / Math.PI
  const offsets = spec.stringer.kind === 'mono' ? [0] : [spec.width / 2 - th / 2, -(spec.width / 2 - th / 2)]
  for (const off of offsets) {
    const c = add(add(base, scale(f, run / 2)), scale(r, off))
    parts.push({
      kind: 'stringer',
      shape: 'box',
      center: [c[0], base[1] + climb / 2 - depth / 2, c[2]],
      size: [th, depth, hyp], // thickness × drop × length-along-rake
      rotYDeg: heading,
      pitchDeg,
    })
  }
}
