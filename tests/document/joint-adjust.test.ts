import { it, expect, describe } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { localDirToWorld } from '../../src/document/math'

describe('adjustJoint — modify a joint by moving the loose piece', () => {
  function riggedAxle() {
    const s = createDocStore()
    const post = makePiece('block', [0, 0.3, 0])
    post.anchored = true
    const arm = makePiece('slat', [0.3, 0.3, 0]) // loose
    s.getState().addPiece(post)
    s.getState().addPiece(arm)
    // A hinge about world +z through the post center.
    const store = s.getState()
    store.select(null)
    ;(s.setState as unknown as (p: object) => void)({
      doc: {
        ...s.getState().doc,
        fasteners: [
          {
            id: 'j1',
            type: 'pivot',
            partA: post.id,
            partB: arm.id,
            anchorA: [0, 0, 0],
            anchorB: [-0.3, 0, 0],
            axisA: [0, 0, 1],
          },
        ],
      },
    })
    return { s, armId: arm.id }
  }

  it('rotate turns the loose arm about the axis (angle actually changes)', () => {
    const { s, armId } = riggedAxle()
    const before = s.getState().doc.pieces.find((p) => p.id === armId)!.state.transform.rotation
    s.getState().adjustJoint('j1', { rotate: Math.PI / 2 })
    const after = s.getState().doc.pieces.find((p) => p.id === armId)!.state.transform.rotation
    // A 90° turn about z is a real change; the arm also swung to a new position.
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before))
    const az = localDirToWorld({ position: [0, 0, 0], rotation: after }, [1, 0, 0])
    expect(Math.abs(az[1])).toBeGreaterThan(0.9) // arm's long axis now points up-ish
  })

  it('the anchored piece never moves; only the loose one adjusts', () => {
    const { s } = riggedAxle()
    const postBefore = s.getState().doc.pieces[0].state.transform.position
    s.getState().adjustJoint('j1', { rotate: 0.5 })
    expect(s.getState().doc.pieces[0].state.transform.position).toEqual(postBefore)
  })

  it('slide moves the loose piece along the axis', () => {
    const { s, armId } = riggedAxle()
    const before = s.getState().doc.pieces.find((p) => p.id === armId)!.state.transform.position[2]
    s.getState().adjustJoint('j1', { slide: 0.1 })
    const after = s.getState().doc.pieces.find((p) => p.id === armId)!.state.transform.position[2]
    expect(after - before).toBeCloseTo(0.1, 3)
  })

  it('refuses to fold a hinged cube INTO its neighbour (crossed-joints veto)', () => {
    const s = createDocStore()
    const a = makePiece('block', [0, 0.15, 0])
    a.dimensions = { x: 0.9, y: 0.9, z: 0.9 }
    a.anchored = true
    const b = makePiece('block', [0.9, 0.15, 0])
    b.dimensions = { x: 0.9, y: 0.9, z: 0.9 }
    s.getState().addPiece(a)
    s.getState().addPiece(b)
    s.getState().setTool('joint')
    s.getState().setJointType('pivot')
    // Hinge on the facing top edges → cubes land flush side by side.
    s.getState().jointClick(a.id, [0.44, 0.6, 0])
    s.getState().jointClick(b.id, [0.46, 0.6, 0])
    const fid = s.getState().doc.fasteners[0].id
    const before = s.getState().doc.pieces.find((p) => p.id === b.id)!.state.transform.position
    // Folding B back toward A (negative rotation) drives it into A → refused.
    s.getState().adjustJoint(fid, { rotate: -Math.PI / 2 })
    const after = s.getState().doc.pieces.find((p) => p.id === b.id)!.state.transform.position
    expect(after).toEqual(before) // did not move
    expect(s.getState().jointNotice).toMatch(/hit another part/i)
  })
})
