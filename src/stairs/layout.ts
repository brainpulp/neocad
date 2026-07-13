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
export type PartKind = 'tread' | 'riser' | 'landing' | 'stringer' | 'fascia' | 'rail' | 'baluster' | 'post'

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
/** Heading (deg) of a plan direction (dx,dz): 0 = +Z, +90 = +X. */
function headingOf(dx: number, dz: number): number {
  return (Math.atan2(dx, dz) * 180) / Math.PI
}
/** A vertical board hanging `depth` below `top`, running plan-edge P0→P1. */
function fasciaBoard(kind: PartKind, P0: Vec3, P1: Vec3, top: number, depth: number, th: number): Part {
  const dx = P1[0] - P0[0]
  const dz = P1[2] - P0[2]
  const len = Math.hypot(dx, dz)
  return {
    kind,
    shape: 'box',
    center: [(P0[0] + P1[0]) / 2, top - depth / 2, (P0[2] + P1[2]) / 2],
    size: [th, depth, len],
    rotYDeg: headingOf(dx, dz),
  }
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

/**
 * Resolve the steps per straight flight. A turn may fix the count of the flight
 * that LEADS UP TO it (`stepsBefore`); the remaining steps are split evenly across
 * the un-fixed flights (the final flight is always auto). This is what lets the
 * user decide how many steps come before each turn.
 */
function resolveFlights(straightSteps: number, turns: TurnSpec[]): number[] {
  const n = turns.length + 1
  const fixed: (number | null)[] = Array.from({ length: n }, (_, i) => {
    const o = i < turns.length ? turns[i].stepsBefore : undefined
    return o != null && o > 0 ? Math.round(o) : null
  })
  const fixedSum = fixed.reduce<number>((s, v) => s + (v ?? 0), 0)
  const autoIdx = fixed.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0)
  const remaining = Math.max(autoIdx.length, straightSteps - fixedSum)
  const autoSplit = splitFlights(remaining, Math.max(1, autoIdx.length))
  const res = fixed.slice()
  autoIdx.forEach((idx, k) => (res[idx] = autoSplit[k] ?? 1))
  return res.map((v) => (v == null ? 1 : v))
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
  // Closed-string: treads/risers are housed BEHIND the side boards, so they're
  // inset by the stringer thickness and the step profile is hidden from the side.
  const sideInset = spec.stringer.kind === 'closed' ? spec.stringer.thickness : 0
  const stepW = W - 2 * sideInset
  const flightCount = turns.length + 1
  const winderTotal = turns.reduce((s, t) => s + (t.kind === 'winder' ? Math.max(1, t.winderSteps) : 0), 0)
  const straightSteps = Math.max(flightCount, N - winderTotal)
  const flights = resolveFlights(straightSteps, turns)

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
        parts.push({ kind: 'riser', shape: 'box', center: [c[0], base[1] + (k - 1) * rise + rise / 2, c[2]], size: [stepW, rise, Tr], rotYDeg: walk.heading })
      }
      const isFlightTop = k === steps
      if (!isFloorTop && !(isFlightTop && toppedByLanding)) {
        const along = ((2 * k - 1) * G - No) / 2
        const c = add(base, scale(f, along))
        parts.push({ kind: 'tread', shape: 'box', center: [c[0], base[1] + k * rise - Tt / 2, c[2]], size: [stepW, Tt, G + No], rotYDeg: walk.heading })
      }
    }
    emitFlightStringers(parts, spec, base, walk.heading, steps, rise)
    emitFlightRailing(parts, spec, base, walk.heading, steps, rise, walk.climbed === 0)
    // A landing IS the flight's top tread (its top tread was skipped), so it sits
    // one going back — flush on the last riser. Otherwise advance the full run.
    const advance = toppedByLanding ? steps - 1 : steps
    walk.pos = add(add(base, [0, steps * rise, 0]), scale(f, advance * G))
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
    const farOuter = add(entryOuter, scale(f, W))
    const str = spec.stringer
    const center = add(A, scale(f, half))
    parts.push({ kind: 'landing', shape: 'box', center: [center[0], top - Tt / 2, center[2]], size: [W, Tt, W], rotYDeg: walk.heading })
    // Fascia around the two OUTER edges (the L-bend) — continues the sidings.
    if (str.kind !== 'none') {
      parts.push(fasciaBoard('fascia', entryOuter, farOuter, top, str.depth, str.thickness))
      parts.push(fasciaBoard('fascia', farOuter, farInner, top, str.depth, str.thickness))
    }
    // Flight 2 departs from the MIDDLE of the turn-side edge of the landing:
    // step to the inner corner, then along the ORIGINAL forward by half a width
    // (the turn-side edge runs along `f`). Using the rotated forward here was the
    // bug that left flight 2 floating half a width off the landing.
    const exit = add(entryInner, scale(f, half))
    walk.pos = [exit[0], top, exit[2]]
    walk.heading += s * t.angle
  }

  const emitWinder = (t: TurnSpec) => {
    // A SQUARE-cornered winder: the treads fill a W×W corner whose OUTER boundary
    // is the two perpendicular walls meeting at a 90° corner (not an arc). The
    // newel sits at the inner corner; the outer L-path (nearOuter→farOuter→
    // farInner, length 2W) is divided into `w` equal parts, and each tread is the
    // triangle/quad from the newel to that segment. 2 parts → split by the diagonal
    // to the outer corner (the classic square two-part winder). Always a 90° turn.
    const s = t.direction === 'right' ? 1 : -1
    const w = Math.max(2, t.winderSteps)
    const A = walk.pos
    const f = forward(walk.heading)
    const r = right(walk.heading)
    const half = W / 2
    const nearOuter = add(A, scale(r, -s * half))
    const nearInner = add(A, scale(r, s * half)) // the newel corner
    const farOuter = add(nearOuter, scale(f, W))
    const farInner = add(nearInner, scale(f, W))
    const newel = nearInner
    const lerp = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, 0, a[2] + (b[2] - a[2]) * u]
    const outerAt = (d: number): Vec3 => (d <= W ? lerp(nearOuter, farOuter, d / W) : lerp(farOuter, farInner, (d - W) / W))
    const str = spec.stringer
    for (let i = 1; i <= w; i++) {
      const d0 = ((i - 1) / w) * 2 * W
      const d1 = (i / w) * 2 * W
      const chain: Vec3[] = [outerAt(d0)]
      if (d0 < W && d1 > W) chain.push(farOuter) // the segment rounds the outer corner
      chain.push(outerAt(d1))
      const top = A[1] + i * rise
      parts.push({
        kind: 'tread',
        shape: 'prism',
        polygon: ensureCCW([[newel[0], newel[2]], ...chain.map((p) => [p[0], p[2]] as [number, number])]),
        bottom: top - Tt,
        top,
      })
      // Fascia along the outer boundary segment(s) of this tread.
      if (str.kind !== 'none') {
        for (let k = 0; k < chain.length - 1; k++) {
          parts.push(fasciaBoard('fascia', [chain[k][0], top, chain[k][2]], [chain[k + 1][0], top, chain[k + 1][2]], top, str.depth, str.thickness))
        }
      }
    }
    // Flight 2 leaves from the middle of the exit edge (newel→farInner), turned 90°.
    const exitMid = lerp(nearInner, farInner, 0.5)
    walk.pos = [exitMid[0], A[1] + w * rise, exitMid[2]]
    walk.heading += s * 90
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
  // Negative: pitching a box about +X sends its +Z (forward) end DOWN, but the
  // flight climbs as it goes forward — so rake up, not down.
  const pitchDeg = (-Math.atan2(climb, run) * 180) / Math.PI
  // The raw raked board would top out on the GOING line (through the tread backs),
  // one whole rise BELOW the nosing line, so every step pokes up above it. Lift the
  // top edge to the nosing line; a CLOSED string lifts an extra `margin` above so
  // the board hides the whole step profile (the treads are already inset behind it).
  const margin = spec.stringer.kind === 'closed' ? 0.06 : 0
  const lift = rise + margin
  const boardH = depth + lift
  const offsets = spec.stringer.kind === 'mono' ? [0] : [spec.width / 2 - th / 2, -(spec.width / 2 - th / 2)]
  for (const off of offsets) {
    const c = add(add(base, scale(f, run / 2)), scale(r, off))
    parts.push({
      kind: 'stringer',
      shape: 'box',
      center: [c[0], base[1] + climb / 2 - depth / 2 + lift / 2, c[2]],
      size: [th, boardH, hyp], // thickness × height × length-along-rake
      rotYDeg: heading,
      pitchDeg,
    })
  }
}

// ---- railings (handrail + balusters + newel posts) -------------------------
/**
 * Per straight flight: a raking handrail above the nosing line, balusters spaced
 * ≤ the code gap from the treads up to the rail, and newel posts at the flight
 * ends. Turns are handled the way real stairs do — a newel post at each flight
 * end (i.e. at every landing/winder junction), with the rail restarting past it.
 */
function emitFlightRailing(parts: Part[], spec: StairSpec, base: Vec3, heading: number, steps: number, rise: number, isFirst: boolean) {
  const R = spec.railing
  if (R.sides === 'none' || steps <= 0) return
  const f = forward(heading)
  const r = right(heading)
  const G = spec.going
  const W = spec.width
  const run = steps * G
  const climb = steps * rise
  const hyp = Math.hypot(run, climb)
  const pitchDeg = (-Math.atan2(climb, run) * 180) / Math.PI // rake up-forward (see stringers)
  const sides = R.sides === 'both' ? [1, -1] : R.sides === 'right' ? [1] : [-1]
  const ps = R.postSize
  const bs = R.balusterSize
  const Hr = R.height
  for (const side of sides) {
    const lat = scale(r, side * (W / 2 - ps / 2))
    // Handrail — a raked bar above the nosing line (same pitch as the flight).
    const rc = add(add(base, scale(f, run / 2)), lat)
    parts.push({ kind: 'rail', shape: 'box', center: [rc[0], base[1] + climb / 2 + Hr, rc[2]], size: [ps, ps, hyp], rotYDeg: heading, pitchDeg })
    // Balusters — an integer number PER TREAD so they line up with the steps,
    // with the per-tread spacing (a divisor of the going) kept ≤ the code gap.
    const perTread = Math.max(1, Math.ceil(G / Math.max(0.02, R.balusterGap)))
    const spacing = G / perTread
    const count = steps * perTread
    for (let i = 0; i < count; i++) {
      const along = (i + 0.5) * spacing
      const nosingY = base[1] + (along / run) * climb
      const bc = add(add(base, scale(f, along)), lat)
      parts.push({ kind: 'baluster', shape: 'box', center: [bc[0], nosingY + Hr / 2, bc[2]], size: [bs, Hr, bs], rotYDeg: heading })
    }
    // Newel posts — foot (first flight only) and top of every flight.
    if (isFirst) {
      const fc = add(base, lat)
      const postH = Hr + rise
      parts.push({ kind: 'post', shape: 'box', center: [fc[0], base[1] + postH / 2, fc[2]], size: [ps, postH, ps], rotYDeg: heading })
    }
    const tc = add(add(base, scale(f, run)), lat)
    parts.push({ kind: 'post', shape: 'box', center: [tc[0], base[1] + climb + Hr / 2, tc[2]], size: [ps, Hr + ps, ps], rotYDeg: heading })
  }
}
