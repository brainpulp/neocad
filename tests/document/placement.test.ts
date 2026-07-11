import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { MECHANISMS } from '../../src/document/mechanisms'

describe('context-aware placement', () => {
  it('placing a mechanism drops it at the clicked spot, not the origin', () => {
    const s = createDocStore()
    s.getState().setPlacingMechanism('pendulum')
    expect(s.getState().placingMechanismId).toBe('pendulum')
    s.getState().placeMechanismAt([2, 0, -1.5])
    const st = s.getState()
    expect(st.placingMechanismId).toBeNull()
    // Every piece sits around the clicked XZ, not around the origin.
    const base = st.doc.pieces.find((p) => p.name === 'Base')!
    expect(base.state.transform.position[0]).toBeCloseTo(2, 5)
    expect(base.state.transform.position[2]).toBeCloseTo(-1.5, 5)
  })

  it('no mechanism piece is anchored to the world (only the user pins things)', () => {
    for (const m of MECHANISMS) {
      const { pieces } = m.build()
      for (const p of pieces) {
        expect(p.anchored, `${m.id}/${p.name} must not be anchored`).toBeFalsy()
      }
    }
  })

  it('mechanism parts are fixed to each other, not free-floating', () => {
    for (const m of MECHANISMS) {
      const { pieces, fasteners, ropes } = m.build()
      // Union-find over fasteners + rope attachments.
      const parent = new Map(pieces.map((p) => [p.id, p.id]))
      const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!))
      const union = (a: string, b: string) => parent.set(find(a), find(b))
      for (const f of fasteners) union(f.partA, f.partB)
      for (const r of ropes ?? []) {
        if (r.attachStart && r.attachEnd) union(r.attachStart.pieceId, r.attachEnd.pieceId)
      }
      // The main assembly is one component; at most ONE piece may be a
      // deliberately-loose projectile (the catapult payload).
      const sizes = new Map<string, number>()
      for (const p of pieces) {
        const r = find(p.id)
        sizes.set(r, (sizes.get(r) ?? 0) + 1)
      }
      const loose = [...sizes.values()].filter((n) => n === 1).length
      const components = sizes.size
      expect(components - loose, `${m.id} main assembly`).toBe(1)
      expect(loose, `${m.id} loose pieces`).toBeLessThanOrEqual(1)
    }
  })

  it('mechanism placement is one undo entry', () => {
    const s = createDocStore()
    s.getState().setPlacingMechanism('seesaw')
    s.getState().placeMechanismAt([0, 0, 0])
    const count = s.getState().doc.pieces.length
    expect(count).toBeGreaterThan(1)
    s.getState().undo()
    expect(s.getState().doc.pieces.length).toBe(0)
  })

  it('selecting a stock tool cancels a pending mechanism (mutually exclusive)', () => {
    const s = createDocStore()
    s.getState().setPlacingMechanism('gate')
    s.getState().setActiveTool('block')
    expect(s.getState().placingMechanismId).toBeNull()
    expect(s.getState().activeTool).toBe('block')
  })

  it('commitHeldAt places the piece where told (no sky-drop height added)', () => {
    const s = createDocStore()
    s.getState().setActiveTool('block')
    s.getState().commitHeldAt([0.5, 0.2, 0.5]) // resting height passed by the ghost
    const p = s.getState().doc.pieces[0]
    expect(p.state.transform.position).toEqual([0.5, 0.2, 0.5])
    expect(makePiece('block', [0, 0, 0]).anchored).toBe(false)
  })
})
