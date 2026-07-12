import { describe, it, expect } from 'vitest'
import { defaultStairSpec, type StairSpec } from '../../src/stairs/spec'
import { layoutStair, riserCount } from '../../src/stairs/layout'

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
