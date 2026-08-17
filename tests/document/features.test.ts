import { it, expect, describe } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { snapToFeature, suggestJoint } from '../../src/document/features'

describe('feature snapping', () => {
  it('a rod click snaps to the centerline at the clicked height', () => {
    const rod = makePiece('rod', [0, 0, 0]) // radius .05, height 1
    const f = snapToFeature(rod, [0.05, 0.2, 0]) // on the side, 20cm up
    expect(f.kind).toBe('axis')
    expect(f.point[0]).toBe(0)
    expect(f.point[1]).toBeCloseTo(0.2)
    expect(f.axis).toEqual([0, 1, 0])
  })

  it('a rod click near the tip snaps to the end', () => {
    const rod = makePiece('rod', [0, 0, 0])
    const f = snapToFeature(rod, [0.02, 0.5, 0])
    expect(f.kind).toBe('end')
    expect(f.point[1]).toBeCloseTo(0.5)
  })

  it('a gear click anywhere snaps to its bore with the spin axis', () => {
    const gear = makePiece('gear', [0, 0, 0]) // radius .12
    const f = snapToFeature(gear, [0.11, 0.01, 0.03]) // out on a tooth
    expect(f.kind).toBe('bore')
    expect(f.point).toEqual([0, 0, 0])
    expect(f.axis).toEqual([0, 1, 0])
  })

  it("a cam's bore is offset by its lobe", () => {
    const cam = makePiece('cam', [0, 0, 0]) // radius .06, lobe .03
    const f = snapToFeature(cam, [-0.03, 0, 0.005])
    expect(f.kind).toBe('bore')
    expect(f.point[0]).toBeCloseTo(-0.03)
  })

  it('a box click near a long edge snaps onto the edge at the clicked spot', () => {
    const joist = makePiece('joist', [0, 0, 0]) // x .09, y .04, z 1.2
    const f = snapToFeature(joist, [0.045, 0.02, 0.4]) // top-x edge, 40cm along
    expect(f.kind).toBe('edge')
    expect(f.point[2]).toBeCloseTo(0.4) // projected along the edge, not its midpoint
    expect(f.axis).toEqual([0, 0, 1]) // hinge axis runs along the edge
  })

  it('a box click mid-face snaps to the face center with its normal as axis', () => {
    const block = makePiece('block', [0, 0, 0]) // 0.3 cube
    const f = snapToFeature(block, [0.15, 0.01, 0.02]) // middle of +x face
    expect(f.kind).toBe('face')
    expect(f.point).toEqual([0.15, 0, 0])
    expect(f.axis).toEqual([1, 0, 0])
  })
})

describe('joint type suggestion', () => {
  const feat = (kind: import('../../src/document/features').FeatureKind, axis: [number, number, number] | null) =>
    ({ kind, label: '', point: [0, 0, 0], axis }) as import('../../src/document/features').JointFeature
  const bore = feat('bore', [0, 1, 0])
  const axis = feat('axis', [0, 1, 0])
  const edge = feat('edge', [1, 0, 0])
  const face = feat('face', [1, 0, 0])
  const center = feat('center', null)

  it('bore on shaft → cylindrical', () => expect(suggestJoint(bore, axis)).toBe('cylindrical'))
  it('edge on face → pivot (hinge)', () => expect(suggestJoint(edge, face)).toBe('pivot'))
  it('face on face → linear (slide)', () => expect(suggestJoint(face, face)).toBe('linear'))
  it('center alone → weld (no articulation implied)', () => expect(suggestJoint(center)).toBe('weld'))
  it('single bore → cylindrical', () => expect(suggestJoint(bore)).toBe('cylindrical'))
})
