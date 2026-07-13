import { describe, it, expect } from 'vitest'
import { defaultStairSpec, newTurn, type StairSpec } from '../../src/stairs/spec'
import { layoutStair, riserCount } from '../../src/stairs/layout'

const noStringer = { kind: 'none' as const, thickness: 0.04, depth: 0.25 }

describe('stairs/layout', () => {
  it('byRise derives an equal-riser count near the target', () => {
    const spec: StairSpec = { ...defaultStairSpec(), totalRise: 2.7, sizing: { mode: 'byRise', targetRise: 0.18 } }
    const N = riserCount(spec) // round(2.7/0.18) = 15
    expect(N).toBe(15)
    const { metrics } = layoutStair(spec)
    expect(metrics.risers).toBe(15)
    expect(metrics.rise).toBeCloseTo(2.7 / 15, 6) // exactly equal risers
    expect(metrics.treads).toBe(14) // top step lands on the upper floor
  })

  it('byCount fixes N and derives the rise; risers sum to totalRise', () => {
    const spec: StairSpec = { ...defaultStairSpec(), totalRise: 3.0, sizing: { mode: 'byCount', count: 12 } }
    const { metrics } = layoutStair(spec)
    expect(metrics.risers).toBe(12)
    expect(metrics.rise * metrics.risers).toBeCloseTo(3.0, 6)
  })

  it('never produces fewer than 2 risers', () => {
    expect(riserCount({ ...defaultStairSpec(), sizing: { mode: 'byCount', count: 1 } })).toBe(2)
    expect(riserCount({ ...defaultStairSpec(), totalRise: 0.05, sizing: { mode: 'byRise', targetRise: 0.18 } })).toBe(2)
  })

  it('emits a riser per step (closed) + a tread per step below the top', () => {
    const spec: StairSpec = { ...defaultStairSpec(), sizing: { mode: 'byCount', count: 10 }, riserMode: 'closed' }
    const { parts } = layoutStair(spec)
    expect(parts.filter((p) => p.kind === 'riser')).toHaveLength(10)
    expect(parts.filter((p) => p.kind === 'tread')).toHaveLength(9)
  })

  it('open risers omit the riser boxes', () => {
    const spec: StairSpec = { ...defaultStairSpec(), sizing: { mode: 'byCount', count: 10 }, riserMode: 'open' }
    const { parts } = layoutStair(spec)
    expect(parts.filter((p) => p.kind === 'riser')).toHaveLength(0)
    expect(parts.filter((p) => p.kind === 'tread')).toHaveLength(9)
  })

  it('the top tread sits at the top of the flight and totalRun = (N-1)·going', () => {
    const spec: StairSpec = { ...defaultStairSpec(), totalRise: 2.0, going: 0.25, sizing: { mode: 'byCount', count: 8 } }
    const { parts, metrics } = layoutStair(spec)
    expect(metrics.totalRun).toBeCloseTo(7 * 0.25, 6)
    const topTread = parts.filter((p) => p.kind === 'tread').at(-1)!
    if (topTread.shape !== 'box') throw new Error('expected box tread')
    // top tread's top surface (centre.y + halfThickness) is at (N-1)·rise
    const topY = topTread.center[1] + topTread.size[1] / 2
    expect(topY).toBeCloseTo(7 * (2.0 / 8), 6)
  })

  it('flags a too-steep rise and a shallow going as advisories', () => {
    const steep: StairSpec = { ...defaultStairSpec(), totalRise: 3.0, going: 0.2, sizing: { mode: 'byCount', count: 10 } }
    const { advisories } = layoutStair(steep) // rise = 0.3 m — well over the 196 mm band
    expect(advisories.some((a) => /Rise/.test(a))).toBe(true)
    expect(advisories.some((a) => /Going/.test(a))).toBe(true)
  })

  it('computes pitch and the 2R+G comfort number', () => {
    const spec: StairSpec = { ...defaultStairSpec(), totalRise: 1.8, going: 0.28, sizing: { mode: 'byCount', count: 10 } }
    const { metrics } = layoutStair(spec)
    expect(metrics.rise).toBeCloseTo(0.18, 6)
    expect(metrics.twoRplusG).toBeCloseTo(2 * 0.18 + 0.28, 6)
    expect(metrics.pitchDeg).toBeCloseTo((Math.atan2(0.18, 0.28) * 180) / Math.PI, 4)
  })
})

describe('stairs/layout — turns', () => {
  it('stepsBefore fixes a flight; the rest go to the remaining flights', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      sizing: { mode: 'byCount', count: 16 },
      turns: [
        newTurn({ kind: 'landing', stepsBefore: 5 }),
        newTurn({ kind: 'landing' }), // auto
      ],
    }
    // 16 straight steps, flight 0 fixed at 5 → remaining 11 split across 2 → [5,6,5] or [5,6,5]/[5,5,6]
    const { metrics } = layoutStair(spec)
    expect(metrics.flights[0]).toBe(5)
    expect(metrics.flights.reduce((a, b) => a + b, 0)).toBe(16)
  })

  it('an L (90° landing) splits into two flights and preserves equal risers', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'landing', landingShape: 'square' })],
    }
    const { parts, metrics } = layoutStair(spec)
    expect(metrics.flights).toEqual([8, 8]) // 16 straight steps, split evenly
    expect(metrics.risers).toBe(16)
    expect(metrics.rise).toBeCloseTo(spec.totalRise / 16, 6)
    // one square landing (a box), no prism parts
    const landings = parts.filter((p) => p.kind === 'landing')
    expect(landings).toHaveLength(1)
    expect(landings[0].shape).toBe('box')
  })

  it('flight 2 seats on the landing edge — no floating gap (regression)', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      width: 1,
      going: 0.25,
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'landing', landingShape: 'square' })],
    }
    const { parts } = layoutStair(spec)
    const landing = parts.find((p) => p.kind === 'landing')!
    if (landing.shape !== 'box') throw new Error('expected box')
    const landingRightEdge = landing.center[0] + landing.size[0] / 2 // +X face
    const f2 = parts.filter((p) => p.kind === 'tread' && p.shape === 'box' && Math.abs(p.rotYDeg - 90) < 1)
    // the first flight-2 tread's near (foot) edge must meet the landing edge, not
    // sit half a width beyond it (the bug that left flight 2 floating).
    const firstNearX = (f2[0] as { center: [number, number, number] }).center[0] - spec.going / 2
    expect(Math.abs(firstNearX - landingRightEdge)).toBeLessThan(0.1)
  })

  it('a square two-part winder splits the corner by the diagonal to the outer corner', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      width: 1,
      going: 0.25,
      sizing: { mode: 'byCount', count: 14 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'winder', winderSteps: 2 })],
    }
    const { parts, metrics } = layoutStair(spec)
    // 14 − 2 winder = 12 straight across 2 flights = [6,6]
    expect(metrics.flights).toEqual([6, 6])
    const wedges = parts.filter((p) => p.kind === 'tread' && p.shape === 'prism')
    expect(wedges).toHaveLength(2)
    // each is a triangle (newel + two outer-corner points), not a 4-gon
    wedges.forEach((wg) => {
      if (wg.shape !== 'prism') throw new Error()
      expect(wg.polygon).toHaveLength(3)
    })
  })

  it('a winder consumes its steps and climbs each one equally', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      sizing: { mode: 'byCount', count: 15 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'winder', winderSteps: 3 })],
    }
    const { parts, metrics } = layoutStair(spec)
    // 15 total risers − 3 winder = 12 straight, split across 2 flights = [6,6]
    expect(metrics.flights).toEqual([6, 6])
    const wedges = parts.filter((p) => p.kind === 'tread' && p.shape === 'prism')
    expect(wedges).toHaveLength(3)
    // winder tops climb one rise each
    const tops = wedges.map((w) => (w.shape === 'prism' ? w.top : 0)).sort((a, b) => a - b)
    expect(tops[1] - tops[0]).toBeCloseTo(spec.totalRise / 15, 5)
    expect(metrics.rise).toBeCloseTo(spec.totalRise / 15, 6)
  })

  it('the landing sits flush on the last riser — no one-going gap (regression)', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25 },
      railing: { sides: 'none', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
      going: 0.25,
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'landing', landingShape: 'square' })],
    }
    const parts = layoutStair(spec).parts
    const f1 = parts.filter((p) => p.kind === 'tread' && p.shape === 'box' && p.rotYDeg === 0)
    const lastBack = (() => { const t = f1.at(-1)!; if (t.shape !== 'box') throw new Error(); return t.center[2] + t.size[2] / 2 })()
    const landing = parts.find((p) => p.kind === 'landing')!
    if (landing.shape !== 'box') throw new Error('expected box')
    const near = landing.center[2] - landing.size[2] / 2
    expect(Math.abs(near - lastBack)).toBeLessThan(1e-6) // flush, no gap
  })

  it('stringers rake UP with the flight, not down (regression)', () => {
    // closed strings are solid boxes (two-side is a notched csg); check the box pitch
    const spec: StairSpec = { ...defaultStairSpec(), stringer: { kind: 'closed', thickness: 0.04, depth: 0.25 }, sizing: { mode: 'byCount', count: 12 } }
    const stringer = layoutStair(spec).parts.find((p) => p.kind === 'stringer')!
    if (stringer.shape !== 'box') throw new Error('expected box')
    // a positive pitch would send the forward (+Z) end down; the flight climbs, so
    // the pitch must be negative.
    expect(stringer.pitchDeg).toBeLessThan(0)
  })

  it('a landing turn adds fascia so the sidings continue through the corner', () => {
    const withStr: StairSpec = {
      ...defaultStairSpec(),
      railing: { sides: 'none', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'landing', landingShape: 'square' })],
    }
    const fascia = layoutStair(withStr).parts.filter((p) => p.kind === 'fascia')
    expect(fascia.length).toBe(2) // the two outer edges of the square landing (the L-bend)
    // …and none when stringers are off
    const noStr = layoutStair({ ...withStr, stringer: { kind: 'none', thickness: 0.04, depth: 0.25 } })
    expect(noStr.parts.filter((p) => p.kind === 'fascia')).toHaveLength(0)
  })

  it('railings emit a rail, balusters and newel posts per flight/side', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25 },
      sizing: { mode: 'byCount', count: 16 },
      railing: { sides: 'both', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
      turns: [newTurn({ angle: 90, direction: 'right', kind: 'landing', landingShape: 'square' })],
    }
    const parts = layoutStair(spec).parts
    // two flights × two sides = 2 rails/flight-side
    expect(parts.filter((p) => p.kind === 'rail')).toHaveLength(4)
    // posts: foot (first flight, both sides = 2) + top of each flight (2 flights × 2 sides = 4)
    expect(parts.filter((p) => p.kind === 'post')).toHaveLength(6)
    expect(parts.filter((p) => p.kind === 'baluster').length).toBeGreaterThan(0)
    // 'right' only halves the rail count
    const rightOnly = layoutStair({ ...spec, railing: { ...spec.railing, sides: 'right' } })
    expect(rightOnly.parts.filter((p) => p.kind === 'rail')).toHaveLength(2)
    // 'none' removes all railing parts
    const none = layoutStair({ ...spec, railing: { ...spec.railing, sides: 'none' } })
    expect(none.parts.filter((p) => ['rail', 'baluster', 'post'].includes(p.kind))).toHaveLength(0)
  })

  it('balusters are an integer count per tread, spaced a divisor of the going', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25 },
      going: 0.3,
      sizing: { mode: 'byCount', count: 11 },
      railing: { sides: 'right', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
    }
    const balusters = layoutStair(spec).parts.filter((p) => p.kind === 'baluster').length
    // going 300 mm, gap ≤ 100 mm → 3 balusters per tread; 11 flight steps → 33
    expect(balusters).toBe(11 * 3)
  })

  it('closed-string houses the treads behind the boards (narrower treads)', () => {
    const base: StairSpec = {
      ...defaultStairSpec(),
      width: 1,
      railing: { sides: 'none', height: 0.9, postSize: 0.08, balusterSize: 0.03, balusterGap: 0.1 },
      sizing: { mode: 'byCount', count: 12 },
    }
    const th = 0.04
    const open = layoutStair({ ...base, stringer: { kind: 'two-side', thickness: th, depth: 0.25 } })
    const closed = layoutStair({ ...base, stringer: { kind: 'closed', thickness: th, depth: 0.25 } })
    const width = (l: typeof open) => {
      const t = l.parts.find((p) => p.kind === 'tread' && p.shape === 'box')!
      if (t.shape !== 'box') throw new Error()
      return t.size[0]
    }
    expect(width(open)).toBeCloseTo(1, 6) // full width
    expect(width(closed)).toBeCloseTo(1 - 2 * th, 6) // inset by a board thickness each side
  })

  it('two winders (a U made of two quarter-turns) both fan', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: noStringer,
      sizing: { mode: 'byCount', count: 18 },
      turns: [
        newTurn({ angle: 90, direction: 'right', kind: 'winder', winderSteps: 3 }),
        newTurn({ angle: 90, direction: 'right', kind: 'winder', winderSteps: 3 }),
      ],
    }
    const { parts, metrics } = layoutStair(spec)
    expect(metrics.flights).toEqual([4, 4, 4]) // 18-6 winder = 12 across 3 flights
    expect(parts.filter((p) => p.kind === 'tread' && p.shape === 'prism')).toHaveLength(6)
  })
})
