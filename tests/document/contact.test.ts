import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { piecesOverlap, surfaceAnchor, supportLocal } from '../../src/document/contact'
import type { Transform, Vec3 } from '../../src/document/types'

const at = (position: Vec3, rotation: Transform['rotation'] = [0, 0, 0, 1]): Transform => ({
  position,
  rotation,
})
const rotZ = (deg: number): Transform['rotation'] => {
  const a = (deg * Math.PI) / 180
  return [0, 0, Math.sin(a / 2), Math.cos(a / 2)]
}
const rotX = (deg: number): Transform['rotation'] => {
  const a = (deg * Math.PI) / 180
  return [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
}

describe('surfaceAnchor: nearest surface point + outward normal', () => {
  it('box: a click near the +x side lands on the +x face with its outward normal', () => {
    const b = makePiece('block', [0, 0, 0]) // 0.3³
    const a = surfaceAnchor(b, [0.14, 0.05, -0.02])
    expect(a.normal).toEqual([1, 0, 0])
    expect(a.point[0]).toBeCloseTo(0.15)
    expect(a.point[1]).toBeCloseTo(0.05)
    expect(a.point[2]).toBeCloseTo(-0.02)
  })

  it('cylinder: a click on the barrel gives a radial normal at the barrel radius', () => {
    const r = makePiece('rod', [0, 0, 0]) // radius 0.05, height 1
    const a = surfaceAnchor(r, [0.04, 0.2, 0])
    expect(a.normal).toEqual([1, 0, 0])
    expect(a.point).toEqual([0.05, 0.2, 0])
  })

  it('cylinder: a click near the top cap gives the ±y cap, signed', () => {
    const r = makePiece('rod', [0, 0, 0])
    const top = surfaceAnchor(r, [0.01, 0.49, 0])
    expect(top.normal).toEqual([0, 1, 0])
    expect(top.point[1]).toBeCloseTo(0.5)
    const bottom = surfaceAnchor(r, [0.01, -0.49, 0])
    expect(bottom.normal).toEqual([0, -1, 0])
  })

  it('sphere: normal is radial', () => {
    const s = makePiece('ball', [0, 0, 0]) // radius 0.15
    const a = surfaceAnchor(s, [0, 0.1, 0])
    expect(a.normal).toEqual([0, 1, 0])
    expect(a.point[1]).toBeCloseTo(0.15)
  })

  it('wedge: a click under the base gives the bottom face, downward normal', () => {
    const w = makePiece('wedge', [0, 0, 0]) // 0.4 × 0.2 × 0.3
    const a = surfaceAnchor(w, [0.05, -0.09, 0])
    expect(a.normal).toEqual([0, -1, 0])
    expect(a.point[1]).toBeCloseTo(-0.1)
  })
})

describe('supportLocal sanity', () => {
  it('box support hits the corner along a diagonal', () => {
    const b = makePiece('block', [0, 0, 0])
    expect(supportLocal(b, [1, 1, 1])).toEqual([0.15, 0.15, 0.15])
  })
  it('cylinder support along the axis hits the cap center', () => {
    const r = makePiece('rod', [0, 0, 0])
    expect(supportLocal(r, [0, -1, 0])).toEqual([0, -0.5, 0])
  })
})

describe('piecesOverlap (GJK, shrink-tolerant)', () => {
  it('two separated blocks do not overlap', () => {
    const a = makePiece('block', [0, 0, 0])
    const b = makePiece('block', [0, 0, 0])
    expect(piecesOverlap(a, at([0, 0, 0]), b, at([1, 0, 0]))).toBe(false)
  })

  it('two coincident blocks overlap', () => {
    const a = makePiece('block', [0, 0, 0])
    const b = makePiece('block', [0, 0, 0])
    expect(piecesOverlap(a, at([0, 0, 0]), b, at([0.05, 0, 0]))).toBe(true)
  })

  it('exact face-touch is NOT overlap (the landing contact must survive the veto)', () => {
    const a = makePiece('block', [0, 0, 0])
    const b = makePiece('block', [0, 0, 0])
    expect(piecesOverlap(a, at([0, 0, 0]), b, at([0.3, 0, 0]))).toBe(false)
    // Even a millimetre of numerical slop is tolerated.
    expect(piecesOverlap(a, at([0, 0, 0]), b, at([0.299, 0, 0]))).toBe(false)
  })

  it('a rotated block clipping a corner IS overlap', () => {
    const a = makePiece('block', [0, 0, 0])
    const b = makePiece('block', [0, 0, 0])
    expect(piecesOverlap(a, at([0, 0, 0]), b, at([0.25, 0.25, 0], rotZ(45)))).toBe(true)
  })

  it('a dowel buried co-axially inside a fat rod IS overlap', () => {
    const rod = makePiece('rod', [0, 0, 0])
    rod.dimensions = { ...rod.dimensions, radius: 0.25, height: 1.2 }
    const dowel = makePiece('dowel', [0, 0, 0]) // radius 0.02
    expect(piecesOverlap(rod, at([0, 1, 0]), dowel, at([0, 1, 0]))).toBe(true)
  })

  it('a dowel resting tangent ON the rod surface is NOT overlap', () => {
    const rod = makePiece('rod', [0, 0, 0])
    rod.dimensions = { ...rod.dimensions, radius: 0.25, height: 1.2 }
    const dowel = makePiece('dowel', [0, 0, 0]) // radius 0.02
    // Rod vertical at y=1; dowel lying along z (crosswise), kissing the barrel at x=0.27.
    expect(piecesOverlap(rod, at([0, 1, 0]), dowel, at([0.27, 1, 0], rotX(90)))).toBe(false)
  })

  it('sphere vs box: touching no, sunk yes', () => {
    const ball = makePiece('ball', [0, 0, 0]) // r 0.15
    const box = makePiece('block', [0, 0, 0])
    expect(piecesOverlap(ball, at([0, 0.3, 0]), box, at([0, 0, 0]))).toBe(false)
    expect(piecesOverlap(ball, at([0, 0.2, 0]), box, at([0, 0, 0]))).toBe(true)
  })
})
