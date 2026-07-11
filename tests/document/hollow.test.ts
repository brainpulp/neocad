import { it, expect, describe } from 'vitest'
import { makePiece, pieceVolume } from '../../src/document/catalog'
import { hollowBricks, hollowVolume, clampThickness } from '../../src/document/hollow'

describe('hollow decomposition', () => {
  it('a closed hollow box has 6 walls; an open-top box has 5', () => {
    const box = makePiece('block', [0, 0.2, 0]) // 0.3³
    box.hollow = { thickness: 0.03 }
    expect(hollowBricks(box)).toHaveLength(6)
    box.hollow = { thickness: 0.03, openFace: '+y' }
    expect(hollowBricks(box)).toHaveLength(5)
  })

  it('a hollow box weighs less than the solid one (cavity subtracted)', () => {
    const solid = makePiece('block', [0, 0.2, 0])
    const hollow = makePiece('block', [0, 0.2, 0])
    hollow.hollow = { thickness: 0.03 }
    expect(pieceVolume(hollow)).toBeLessThan(pieceVolume(solid))
    // A 3cm shell of a 30cm cube keeps well under half the solid volume.
    expect(pieceVolume(hollow)).toBeLessThan(pieceVolume(solid) * 0.75)
    expect(pieceVolume(hollow)).toBeGreaterThan(0)
  })

  it('a cylinder tube (no open face) is just the ring — no caps', () => {
    const tube = makePiece('tube', [0, 0.5, 0]) // cylinder
    tube.hollow = { thickness: 0.02 }
    const bricks = hollowBricks(tube)!
    // 12 ring segments, zero caps.
    expect(bricks).toHaveLength(12)
    // A cup keeps one cap.
    tube.hollow = { thickness: 0.02, openFace: '+y' }
    expect(hollowBricks(tube)).toHaveLength(13)
  })

  it('thickness is clamped so a real cavity always remains', () => {
    const box = makePiece('block', [0, 0.2, 0]) // half-extent 0.15
    // Ask for an absurd 1m wall → clamped below the half-extent.
    expect(clampThickness(box, 1)).toBeLessThan(0.15)
    expect(clampThickness(box, 1)).toBeGreaterThan(0)
  })

  it('non-hollowable stock (sphere) yields no bricks', () => {
    const ball = makePiece('ball', [0, 0.2, 0])
    ball.hollow = { thickness: 0.02 }
    expect(hollowBricks(ball)).toBeNull()
    expect(hollowVolume(ball)).toBe(0)
    // pieceVolume falls back to the solid sphere.
    expect(pieceVolume(ball)).toBeGreaterThan(0)
  })
})
