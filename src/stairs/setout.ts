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
  /** Running marks ALONG the board edge (pitch line) to each step, m — the
   *  diagonal measurement you tape along the plank. */
  rakeMarks: number[]
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
      rakeMarks: Array.from({ length: steps + 1 }, (_, k) => k * hypPerStep),
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
 * A dimensioned MARKING TEMPLATE (SVG) for one flight's cut string, drawn in
 * elevation (as installed). It shows the rectangular STOCK PLANK you start from
 * (dashed) with the finished stringer inside it, a START corner, and three running
 * dimension sets from a single datum (so nothing is added up): GOING across the
 * bottom, RISE up the side, and the diagonal ALONG-THE-BOARD marks you tape along
 * the plank. `datum` flips whether the running values count up from the bottom or
 * down from the top.
 */
export function setoutSvg(s: StringerSetout, datum: 'bottom' | 'top' = 'bottom'): string {
  const G = s.unitGoing, R = s.unitRise, run = s.run, climb = s.climb
  const depth = s.blank.width - R
  const th = (s.pitchDeg * Math.PI) / 180
  const c = Math.cos(th), sn = Math.sin(th)
  const hyp = s.hypPerStep
  const Wb = s.blank.width
  const allow = 0.06 // plank end allowance beyond the finished piece, along the rake

  // ---- elevation geometry (metres; x right, y up) --------------------------
  const bottomFront: [number, number] = [0, -depth]
  const bottomBack: [number, number] = [run, climb - depth]
  const u: [number, number] = [c, sn] // rake direction
  const perp: [number, number] = [-sn, c] // up-perpendicular to the rake
  const add = (p: [number, number], v: [number, number], t: number): [number, number] => [p[0] + v[0] * t, p[1] + v[1] * t]
  const pB0 = add(bottomFront, u, -allow)
  const pB1 = add(bottomBack, u, allow)
  const pT0 = add(pB0, perp, Wb)
  const pT1 = add(pB1, perp, Wb)

  // fit
  const xs = [pB0, pB1, pT0, pT1, [0, climb] as [number, number]].map((p) => p[0])
  const ys = [pB0[1], pB1[1], pT0[1], pT1[1], climb]
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys)
  const S = Math.min(1000 / (maxx - minx), 560 / (maxy - miny), 260)
  const padL = 96, padB = 84, padT = 52, padR = 60
  const W = (maxx - minx) * S + padL + padR
  const H = (maxy - miny) * S + padB + padT
  const X = (x: number) => padL + (x - minx) * S
  const Y = (y: number) => H - padB - (y - miny) * S
  const P = (p: [number, number]) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`
  const lbl = (v: number, total: number) => mm(datum === 'bottom' ? v : total - v)

  // finished stringer outline: sawtooth top → top plumb → raked bottom → toe
  const sawtooth = s.corners.map((p) => P([p.x, p.y])).join(' L ')
  const finished = `M ${P([0, 0])} L ${sawtooth} L ${P([run, climb - depth])} L ${P(bottomFront)} Z`
  const plank = `M ${P(pB0)} L ${P(pB1)} L ${P(pT1)} L ${P(pT0)} Z`

  let dims = ''
  // GOING — horizontal running dim under the piece
  const yb = H - padB + 26
  for (let k = 0; k <= s.steps; k++) {
    const x = X(k * G)
    dims += `<line x1="${x}" y1="${Y(-depth)}" x2="${x}" y2="${yb}" stroke="#bbb" stroke-width="0.4" stroke-dasharray="2 2"/>`
    dims += `<text x="${x}" y="${yb + 11}" font-size="8.5" text-anchor="middle" fill="#333">${lbl(k * G, run)}</text>`
  }
  dims += `<line x1="${X(0)}" y1="${yb}" x2="${X(run)}" y2="${yb}" stroke="#666" stroke-width="0.7"/>`
  dims += `<text x="${X(run / 2)}" y="${yb + 24}" font-size="10" text-anchor="middle" fill="#111">GOING ${mm(G)} mm × ${s.steps}  (run ${mm(run)} mm)</text>`
  // RISE — vertical running dim up the left
  const xl = padL - 30
  for (let k = 0; k <= s.steps; k++) {
    const y = Y(k * R)
    dims += `<line x1="${xl}" y1="${y}" x2="${X(0)}" y2="${y}" stroke="#bbb" stroke-width="0.4" stroke-dasharray="2 2"/>`
    dims += `<text x="${xl - 3}" y="${y + 3}" font-size="8.5" text-anchor="end" fill="#333">${lbl(k * R, climb)}</text>`
  }
  dims += `<line x1="${xl}" y1="${Y(0)}" x2="${xl}" y2="${Y(climb)}" stroke="#666" stroke-width="0.7"/>`
  dims += `<text x="${xl - 34}" y="${Y(climb / 2)}" font-size="10" text-anchor="middle" fill="#111" transform="rotate(-90 ${xl - 34} ${Y(climb / 2)})">RISE ${mm(R)} mm × ${s.steps}  (total ${mm(climb)} mm)</text>`
  // DIAGONAL — along-the-board running dim, on a line parallel to the raked bottom
  const dd = 0.11
  const dl0 = add(pB0, perp, -dd), dl1 = add(pB1, perp, -dd)
  dims += `<line x1="${P(dl0).split(',')[0]}" y1="${P(dl0).split(',')[1]}" x2="${P(dl1).split(',')[0]}" y2="${P(dl1).split(',')[1]}" stroke="#c0392b" stroke-width="0.8"/>`
  for (let k = 0; k <= s.steps; k++) {
    const onEdge = add(bottomFront, u, k * hyp)
    const tick0 = add(onEdge, perp, -dd + 0.015), tick1 = add(onEdge, perp, -dd - 0.02)
    dims += `<line x1="${P(tick0).split(',')[0]}" y1="${P(tick0).split(',')[1]}" x2="${P(tick1).split(',')[0]}" y2="${P(tick1).split(',')[1]}" stroke="#c0392b" stroke-width="0.6"/>`
    const t = add(onEdge, perp, -dd - 0.03)
    dims += `<text x="${X(t[0]).toFixed(1)}" y="${Y(t[1]).toFixed(1)}" font-size="8" text-anchor="middle" fill="#c0392b" transform="rotate(${-s.pitchDeg} ${X(t[0]).toFixed(1)} ${Y(t[1]).toFixed(1)})">${lbl(k * hyp, s.steps * hyp)}</text>`
  }
  const midE = add(bottomFront, u, (s.steps * hyp) / 2)
  const midL = add(midE, perp, -dd - 0.06)
  dims += `<text x="${X(midL[0]).toFixed(1)}" y="${Y(midL[1]).toFixed(1)}" font-size="10" fill="#c0392b" text-anchor="middle" transform="rotate(${-s.pitchDeg} ${X(midL[0]).toFixed(1)} ${Y(midL[1]).toFixed(1)})">ALONG BOARD ${mm(hyp)} mm/step — tape along the plank edge</text>`

  // START corner marker (the datum end of the board)
  const startPt: [number, number] = datum === 'bottom' ? bottomFront : bottomBack
  const startLabel = datum === 'bottom' ? 'START — bottom of board (datum 0,0 at the toe above)' : 'START — top of board'
  dims += `<circle cx="${X(startPt[0])}" cy="${Y(startPt[1])}" r="5" fill="#111"/>`
  dims += `<text x="${X(startPt[0]) + (datum === 'bottom' ? 8 : -8)}" y="${Y(startPt[1]) + 16}" font-size="9.5" font-weight="600" text-anchor="${datum === 'bottom' ? 'start' : 'end'}" fill="#111">${startLabel}</text>`
  // datum crosshair at the toe (0,0)
  dims += `<circle cx="${X(0)}" cy="${Y(0)}" r="3" fill="none" stroke="#111" stroke-width="1"/>`
  dims += `<text x="${X(0) + 6}" y="${Y(0) - 5}" font-size="8.5" fill="#111">datum (0,0)</text>`
  // end-cut labels
  dims += `<text x="${X(run) + 6}" y="${Y(climb)}" font-size="9" fill="#333">head: ${s.endTop} cut</text>`
  dims += `<text x="${X(0) + 6}" y="${Y(-depth) + 12}" font-size="9" fill="#333">foot: ${s.endBottom} cut</text>`

  const title = `Flight ${s.flight} — cut-string marking template (elevation) · datum: ${datum}`
  const sub = `START from a rectangular plank ${mm(s.blank.length)}×${mm(s.blank.width)}×${mm(s.blank.thickness)} mm (dashed). pitch ${s.pitchDeg.toFixed(1)}° · throat ${mm(s.throat)} mm${s.throat < 0.089 ? ' ⚠<89' : ''} · bottom drop ${mm(s.bottomDrop)} mm (deduct one tread thickness).`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="system-ui, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="${padL}" y="22" font-size="14" font-weight="600" fill="#111">${title}</text>
<text x="${padL}" y="38" font-size="10.5" fill="#555">${sub}</text>
<path d="${plank}" fill="#f3eee2" stroke="#b9a26f" stroke-width="1" stroke-dasharray="6 4"/>
<path d="${finished}" fill="#e0cfa6" stroke="#7a5a30" stroke-width="1.6" stroke-linejoin="round"/>
${dims}
</svg>`
}
