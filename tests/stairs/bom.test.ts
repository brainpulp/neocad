import { describe, it, expect } from 'vitest'
import { defaultStairSpec, newTurn, type StairSpec } from '../../src/stairs/spec'
import { stairBom, bomToCsv } from '../../src/stairs/bom'

describe('stairs/bom', () => {
  it('groups identical treads/risers into quantities', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25 },
      sizing: { mode: 'byCount', count: 15 },
    }
    const bom = stairBom(spec)
    const treads = bom.lines.find((l) => l.kind === 'tread')!
    const risers = bom.lines.find((l) => l.kind === 'riser')!
    expect(treads.qty).toBe(14) // N-1
    expect(risers.qty).toBe(15)
    // one grouped line each (all identical), not 14/15 separate rows
    expect(bom.lines.filter((l) => l.kind === 'tread')).toHaveLength(1)
    expect(bom.totalVolume).toBeGreaterThan(0)
    expect(bom.boardFeet).toBeGreaterThan(0)
  })

  it('includes stringers and lists the material', () => {
    const spec: StairSpec = { ...defaultStairSpec(), material: 'oak', sizing: { mode: 'byCount', count: 12 } }
    const bom = stairBom(spec)
    expect(bom.material).toBe('oak')
    expect(bom.lines.some((l) => l.kind === 'stringer')).toBe(true)
    expect(bom.lines.find((l) => l.kind === 'stringer')!.qty).toBe(2) // two-side default
  })

  it('counts winder wedges and a landing in a turning stair', () => {
    const spec: StairSpec = {
      ...defaultStairSpec(),
      stringer: { kind: 'none', thickness: 0.04, depth: 0.25 },
      sizing: { mode: 'byCount', count: 16 },
      turns: [newTurn({ kind: 'winder', winderSteps: 3, angle: 90 })],
    }
    const bom = stairBom(spec)
    // 3 winder wedges are 'shaped' treads (prisms) → their own grouped line
    const wedgeLine = bom.lines.find((l) => l.kind === 'tread' && /winder/.test(l.label))
    expect(wedgeLine?.qty).toBe(3)
  })

  it('emits CSV with a header and a total row', () => {
    const csv = bomToCsv(stairBom(defaultStairSpec()))
    expect(csv.split('\n')[0]).toMatch(/Part,Qty,Dimensions/)
    expect(csv).toMatch(/Board-feet/)
  })
})
