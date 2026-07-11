import type { Quat, Vec3 } from '../document/types'

/**
 * The SDF node tree — pure data, three-free. A tree evaluates to a signed
 * distance field: `sdf(node, p)` is the (near-)exact distance from world point
 * `p` to the surface, negative inside. See `eval.ts` (CPU) and `glsl.ts` (GPU),
 * which MUST agree — they share the same primitive/op formulas.
 */
export type SdfNode =
  | { kind: 'sphere'; r: number }
  | { kind: 'box'; half: Vec3 }
  | { kind: 'roundBox'; half: Vec3; radius: number }
  | { kind: 'cylinder'; radius: number; height: number } // axis = Y, centered
  | { kind: 'torus'; major: number; minor: number } // ring in the XZ plane
  | { kind: 'plane'; normal: Vec3; offset: number } // dot(p,n) + offset
  | { kind: 'union'; a: SdfNode; b: SdfNode }
  | { kind: 'subtract'; a: SdfNode; b: SdfNode } // a minus b
  | { kind: 'intersect'; a: SdfNode; b: SdfNode }
  | { kind: 'smoothUnion'; a: SdfNode; b: SdfNode; k: number }
  | { kind: 'smoothSubtract'; a: SdfNode; b: SdfNode; k: number }
  | { kind: 'smoothIntersect'; a: SdfNode; b: SdfNode; k: number }
  | { kind: 'transform'; translate: Vec3; rotate: Quat; scale: number; child: SdfNode }

// --- Builder helpers so trees read like code ------------------------------

export const sphere = (r: number): SdfNode => ({ kind: 'sphere', r })
export const box = (half: Vec3): SdfNode => ({ kind: 'box', half })
export const roundBox = (half: Vec3, radius: number): SdfNode => ({
  kind: 'roundBox',
  half,
  radius,
})
export const cylinder = (radius: number, height: number): SdfNode => ({
  kind: 'cylinder',
  radius,
  height,
})
export const torus = (major: number, minor: number): SdfNode => ({ kind: 'torus', major, minor })
export const plane = (normal: Vec3, offset: number): SdfNode => ({ kind: 'plane', normal, offset })

export const union = (a: SdfNode, b: SdfNode): SdfNode => ({ kind: 'union', a, b })
export const subtract = (a: SdfNode, b: SdfNode): SdfNode => ({ kind: 'subtract', a, b })
export const intersect = (a: SdfNode, b: SdfNode): SdfNode => ({ kind: 'intersect', a, b })
export const smoothUnion = (a: SdfNode, b: SdfNode, k: number): SdfNode => ({
  kind: 'smoothUnion',
  a,
  b,
  k,
})
export const smoothSubtract = (a: SdfNode, b: SdfNode, k: number): SdfNode => ({
  kind: 'smoothSubtract',
  a,
  b,
  k,
})
export const smoothIntersect = (a: SdfNode, b: SdfNode, k: number): SdfNode => ({
  kind: 'smoothIntersect',
  a,
  b,
  k,
})

const IDENTITY_QUAT: Quat = [0, 0, 0, 1]

/** Translate a subtree. */
export const translate = (t: Vec3, child: SdfNode): SdfNode => ({
  kind: 'transform',
  translate: t,
  rotate: IDENTITY_QUAT,
  scale: 1,
  child,
})

/** Full rigid + uniform-scale transform of a subtree. */
export const transform = (
  child: SdfNode,
  opts: { translate?: Vec3; rotate?: Quat; scale?: number } = {},
): SdfNode => ({
  kind: 'transform',
  translate: opts.translate ?? [0, 0, 0],
  rotate: opts.rotate ?? IDENTITY_QUAT,
  scale: opts.scale ?? 1,
  child,
})
