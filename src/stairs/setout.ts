/**
 * Stringer SETOUT — the marking-out dimensions to cut and mark a siding by hand.
 *
 * For a cut (open) string you step a pitch board along the board: every notch is a
 * rise×going right angle. The numbers a builder needs are (a) the blank size, (b)
 * the constant unit rise & going, (c) every notch corner as a RUNNING coordinate
 * from a single datum (the bottom toe) so errors don't accumulate — the software
 * pitch-board/story-pole, (d) the bottom drop (deduct one tread thickness), and
 * (e) the end cuts. Pure: arithmetic only.
 */
import type { StairSpec } from './spec'
import { layoutStair } from './layout'

export interface SetoutCorner {
  /** Running horizontal distance from the datum (bottom toe), m. */
  x: number
  /** Running height from the datum, m. */
  y: number
}

export interface StringerSetout {
  flight: number // 1-based straight-flight index
  steps: number
  unitRise: number
  unitGoing: number
  pitchDeg: number
  /** Pitch-line length per step — how far the square advances along the board (m). */
  hypPerStep: number
  /** Plan run and total climb of this flight (m). */
  run: number
  climb: number
  /** Suggested stock blank: length along the rake × board width × thickness (m). */
  blank: { length: number; width: number; thickness: number }
  /** Deduct this from the bottom (one tread thickness) so step 1 isn't too tall (m). */
  bottomDrop: number
  /** Min solid timber below the deepest notch corner; code wants ≥ 0.089 m. */
  throat: number
  endBottom: string
  endTop: string
  /** The sawtooth profile as running coordinates from the datum (mark these). */
  corners: SetoutCorner[]
  /** Running marks to strike across (going) and up (rise) the board, m. */
  goingMarks: number[]
  riseMarks: number[]
}

/** One setout per straight flight (both side strings of a flight are identical). */
export function flightSetouts(spec: StairSpec): StringerSetout[] {
  if (spec.stringer.kind === 'none') return []
  const { metrics } = layoutStair(spec)
  const G = spec.going
  const R = metrics.rise
  const hypPerStep = Math.hypot(R, G)
  const pitchDeg = (Math.atan2(R, G) * 180) / Math.PI
  const depth = spec.stringer.depth
  const th = spec.stringer.thickness
  const out: StringerSetout[] = []
  metrics.flights.forEach((steps, i) => {
    if (steps <= 0) return
    const run = steps * G
    const climb = steps * R
    const corners: SetoutCorner[] = [{ x: 0, y: 0 }]
    for (let k = 1; k <= steps; k++) {
      corners.push({ x: (k - 1) * G, y: k * R }) // up riser k to the nosing
      corners.push({ x: k * G, y: k * R }) // along tread k to the back
    }
    out.push({
      flight: i + 1,
      steps,
      unitRise: R,
      unitGoing: G,
      pitchDeg,
      hypPerStep,
      run,
      climb,
      blank: { length: Math.hypot(run, climb) + 0.1, width: depth + R, thickness: th },
      bottomDrop: spec.treadThickness,
      throat: depth * Math.cos((pitchDeg * Math.PI) / 180),
      endBottom: spec.stringer.endBottom,
      endTop: spec.stringer.endTop,
      corners,
      goingMarks: Array.from({ length: steps + 1 }, (_, k) => k * G),
      riseMarks: Array.from({ length: steps + 1 }, (_, k) => k * R),
    })
  })
  return out
}

const mm = (x: number) => Math.round(x * 1000)

/** The setout as CSV — a marking table with the running (from-datum) coordinates. */
export function setoutToCsv(setouts: StringerSetout[]): string {
  const rows: string[][] = [['Flight', 'Corner', 'Type', 'Run X (mm)', 'Height Y (mm)']]
  for (const s of setouts) {
    s.corners.forEach((c, i) => {
      const type = i === 0 ? 'toe (datum)' : i % 2 === 1 ? `riser ${(i + 1) / 2} top / nosing` : `tread ${i / 2} back`
      rows.push([String(s.flight), String(i), type, String(mm(c.x)), String(mm(c.y))])
    })
    rows.push([])
    rows.push([`Flight ${s.flight} summary`])
    rows.push(['Unit rise (mm)', String(mm(s.unitRise))])
    rows.push(['Unit going (mm)', String(mm(s.unitGoing))])
    rows.push(['Pitch (deg)', s.pitchDeg.toFixed(1)])
    rows.push(['Pitch length / step (mm)', String(mm(s.hypPerStep))])
    rows.push(['Blank L×W×T (mm)', `${mm(s.blank.length)} x ${mm(s.blank.width)} x ${mm(s.blank.thickness)}`])
    rows.push(['Bottom drop (mm)', String(mm(s.bottomDrop))])
    rows.push(['Throat (mm)', String(mm(s.throat))])
    rows.push(['End bottom / top', `${s.endBottom} / ${s.endTop}`])
    rows.push([])
  }
  return rows.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')).join('\n')
}

/**
 * A dimensioned MARKING TEMPLATE (SVG) for one flight's cut string: the sawtooth
 * profile with running dimensions across (going) and up (rise), the end cuts, the
 * blank, and the drop note. This is the sheet you mark the board from.
 */
export function setoutSvg(s: StringerSetout): string {
  const G = s.unitGoing, R = s.unitRise, run = s.run, climb = s.climb, depth = s.blank.width - R
  const S = Math.min(900 / run, 520 / climb, 260) // px per metre, fit a page
  const padL = 90, padB = 70, padT = 40, padR = 40
  const W = run * S + padL + padR
  const H = climb * S + padB + padT
  const X = (x: number) => padL + x * S
  const Y = (y: number) => H - padB - y * S
  // sawtooth outline points + a raked bottom line `depth` below the going line
  const top = s.corners.map((c) => `${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}`).join(' ')
  const botStart = `${X(0).toFixed(1)},${Y(-depth).toFixed(1)}`
  const botEnd = `${X(run).toFixed(1)},${Y(climb - depth).toFixed(1)}`
  const outline = `M ${X(0).toFixed(1)},${Y(0).toFixed(1)} L ${top.split(' ').join(' L ')} L ${botEnd} L ${botStart} Z`
  let dims = ''
  // horizontal running dimension (going marks) along the bottom
  const yb = H - padB + 24
  for (let k = 0; k <= s.steps; k++) {
    const x = X(k * G)
    dims += `<line x1="${x}" y1="${H - padB}" x2="${x}" y2="${yb}" stroke="#888" stroke-width="0.6"/>`
    dims += `<text x="${x}" y="${yb + 12}" font-size="9" text-anchor="middle" fill="#333">${mm(k * G)}</text>`
  }
  dims += `<line x1="${X(0)}" y1="${yb}" x2="${X(run)}" y2="${yb}" stroke="#888" stroke-width="0.6"/>`
  dims += `<text x="${X(run / 2)}" y="${yb + 26}" font-size="10" text-anchor="middle" fill="#111">going ${mm(G)} mm × ${s.steps} (run ${mm(run)} mm) — mark each from the datum, don't add up</text>`
  // vertical running dimension (rise marks) up the left
  const xl = padL - 26
  for (let k = 0; k <= s.steps; k++) {
    const y = Y(k * R)
    dims += `<line x1="${xl}" y1="${y}" x2="${padL}" y2="${y}" stroke="#888" stroke-width="0.6"/>`
    dims += `<text x="${xl - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="#333">${mm(k * R)}</text>`
  }
  dims += `<line x1="${xl}" y1="${Y(0)}" x2="${xl}" y2="${Y(climb)}" stroke="#888" stroke-width="0.6"/>`
  dims += `<text x="${xl - 30}" y="${Y(climb / 2)}" font-size="10" text-anchor="middle" fill="#111" transform="rotate(-90 ${xl - 30} ${Y(climb / 2)})">rise ${mm(R)} mm × ${s.steps} (total ${mm(climb)} mm)</text>`
  const title = `Flight ${s.flight} — cut-string marking template`
  const sub = `blank ${mm(s.blank.length)}×${mm(s.blank.width)}×${mm(s.blank.thickness)} mm · pitch ${s.pitchDeg.toFixed(1)}° · step along board ${mm(s.hypPerStep)} mm · throat ${mm(s.throat)} mm · bottom drop ${mm(s.bottomDrop)} mm · ends ${s.endBottom}/${s.endTop}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${(H + 30).toFixed(0)}" font-family="system-ui, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="${padL}" y="20" font-size="14" font-weight="600" fill="#111">${title}</text>
<text x="${padL}" y="34" font-size="10" fill="#555">${sub}</text>
<path d="${outline}" fill="#e8dcc4" stroke="#7a5a30" stroke-width="1.4" stroke-linejoin="round"/>
${dims}
</svg>`
}
