import { it, expect } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { transformPatch, MIN_DIM } from '../../src/render/transform'

it('moves and snaps position into both definition and state', () => {
  const p = makePiece('block', [0, 1, 0])
  const patch = transformPatch(p, { position: [0.13, 1.0, -0.04], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] })
  expect(patch.definition!.transform.position).toEqual([0.1, 1.0, -0.0])
  expect(patch.state!.transform.position).toEqual([0.1, 1.0, -0.0])
})

it('scales a box per-axis into dimensions', () => {
  const p = makePiece('block', [0, 0, 0]) // 0.3 cube
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 1, 0.5] })
  expect(patch.dimensions!.x).toBeCloseTo(0.6)
  expect(patch.dimensions!.y).toBeCloseTo(0.3)
  expect(patch.dimensions!.z).toBeCloseTo(0.15)
})

it('scales a cylinder: radius from max(x,z), height from y', () => {
  const p = makePiece('rod', [0, 0, 0]) // radius 0.05, height 1.0
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [3, 2, 1] })
  expect(patch.dimensions!.radius).toBeCloseTo(0.15)
  expect(patch.dimensions!.height).toBeCloseTo(2.0)
})

it('scales a sphere uniformly by the max axis', () => {
  const p = makePiece('ball', [0, 0, 0]) // radius 0.15
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 2, 1] })
  expect(patch.dimensions!.radius).toBeCloseTo(0.3)
})

it('clamps dimensions to a positive minimum', () => {
  const p = makePiece('block', [0, 0, 0])
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [0, 0, 0] })
  expect(patch.dimensions!.x).toBe(MIN_DIM)
})

it('passes rotation through to both transforms', () => {
  const p = makePiece('block', [0, 0, 0])
  const q: [number, number, number, number] = [0, 0.7071, 0, 0.7071]
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: q, scale: [1, 1, 1] })
  expect(patch.definition!.transform.rotation).toEqual(q)
  expect(patch.state!.transform.rotation).toEqual(q)
})
