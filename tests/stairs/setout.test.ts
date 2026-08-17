import { describe, it, expect } from 'vitest'
import { defaultStairSpec, newTurn, type StairSpec } from '../../src/stairs/spec'
import { flightSetouts, setoutToCsv, setoutSvg } from '../../src/stairs/setout'

describe('stairs/setout', () => {
  it('gives one setout per straight flight with running datum coordinates', () => {
    const spec: StairSpec = { ...defaultStairSpec(), going: 0.25, sizing: { mode: 'byCount', count: 12 } }
    const [s] = flightSetouts(spec)
    expect(s.steps).toBe(12)
    const R = spec.totalRise / 12
    // sawtooth: (0,0),(0,R),(G,R),(G,2R),...
    expect(s.corners[0]).toEqual({ x: 0, y: 0 })
    expect(s.corners[1].x).toBeCloseTo(0, 6)
    expect(s.corners[1].y).toBeCloseTo(R, 6)
    expect(s.corners[2].x).toBeCloseTo(0.25, 6)
    expect(s.corners[2].y).toBeCloseTo(R, 6)
    // running marks are exact multiples from the datum (no cumulative addition)
    expect(s.goingMarks[3]).toBeCloseTo(3 * 0.25, 6)
    expect(s.riseMarks[3]).toBeCloseTo(3 * R, 6)
    expect(s.hypPerStep).toBeCloseTo(Math.hypot(R, 0.25), 6)
    expect(s.bottomDrop).toBeCloseTo(spec.treadThickness, 6)
  })

  it('splits setouts per flight for a turning stair', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ kind: 'landing', angle: 90 })],
    }
    const outs = flightSetouts(spec)
    expect(outs.map((s) => s.flight)).toEqual([1, 2])
    expect(outs[0].steps + outs[1].steps).toBe(16)
  })

  it('returns nothing when there are no stringers', () => {
    expect(flightSetouts({ ...defaultStairSpec(), stringer: { ...defaultStairSpec().stringer, kind: 'none' } })).toHaveLength(0)
  })

  it('emits a marking CSV and an SVG template', () => {
    const outs = flightSetouts(defaultStairSpec())
    const csv = setoutToCsv(outs)
    expect(csv).toMatch(/Run X \(mm\)/)
    expect(csv).toMatch(/Unit rise/)
    const svg = setoutSvg(outs[0])
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toMatch(/marking template/)
  })
})
