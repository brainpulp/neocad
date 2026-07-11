import { describe, it, expect } from 'vitest'
import { cutsKey, pieceToCsg, type CutOp } from '../../src/document/cuts'
import type { Piece } from '../../src/document/types'

function block(cuts?: CutOp[]): Piece {
  return {
    id: 'p',
    name: 'Block',
    stockType: 'block',
    dimensions: { x: 0.3, y: 0.3, z: 0.3 },
    material: 'wood',
    definition: { transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    state: { transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    anchored: false,
    cuts,
  }
}

describe('document/cuts', () => {
  it('no cuts → null (piece renders as its plain primitive)', () => {
    expect(pieceToCsg(block())).toBeNull()
    expect(pieceToCsg(block([]))).toBeNull()
  })

  it('a bore builds base − oriented cylinder', () => {
    const node = pieceToCsg(block([{ id: 'c1', tool: 'bore', radius: 0.05, axis: 'y', offset: [0, 0] }]))
    expect(node?.kind).toBe('subtract')
    if (node?.kind !== 'subtract') throw new Error('expected subtract')
    expect(node.a.kind).toBe('box')
    // the tool is a transformed cylinder (a Y bore → no rotate, just placement)
    expect(node.b.kind).toBe('transform')
    if (node.b.kind !== 'transform') throw new Error('expected transform')
    expect(node.b.child.kind).toBe('cylinder')
  })

  it('X and Z bores carry a rotation; Y does not', () => {
    const y = pieceToCsg(block([{ id: 'c', tool: 'bore', radius: 0.05, axis: 'y', offset: [0, 0] }]))
    const x = pieceToCsg(block([{ id: 'c', tool: 'bore', radius: 0.05, axis: 'x', offset: [0, 0] }]))
    const tf = (n: ReturnType<typeof pieceToCsg>) =>
      n?.kind === 'subtract' && n.b.kind === 'transform' ? n.b.rotate : undefined
    expect(tf(y)).toBeUndefined()
    expect(tf(x)).toEqual([0, 0, 90])
  })

  it('multiple bores chain as nested subtracts', () => {
    const node = pieceToCsg(
      block([
        { id: 'c1', tool: 'bore', radius: 0.04, axis: 'y', offset: [0, 0] },
        { id: 'c2', tool: 'bore', radius: 0.04, axis: 'x', offset: [0, 0] },
      ]),
    )
    // outer subtract's `a` is itself a subtract (the first bore)
    expect(node?.kind).toBe('subtract')
    if (node?.kind !== 'subtract') throw new Error('expected subtract')
    expect(node.a.kind).toBe('subtract')
  })

  it('cutsKey changes when a bore changes, stable otherwise', () => {
    const a = block([{ id: 'c', tool: 'bore', radius: 0.05, axis: 'y', offset: [0, 0] }])
    const b = block([{ id: 'c', tool: 'bore', radius: 0.06, axis: 'y', offset: [0, 0] }])
    expect(cutsKey(a)).toBe(cutsKey(block([{ id: 'c', tool: 'bore', radius: 0.05, axis: 'y', offset: [0, 0] }])))
    expect(cutsKey(a)).not.toBe(cutsKey(b))
    expect(cutsKey(block())).toBe('')
  })
})
