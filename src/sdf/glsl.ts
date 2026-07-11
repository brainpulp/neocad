import type { Quat } from '../document/types'
import type { SdfNode } from './tree'

/** Format a JS number as a GLSL float literal (always with a decimal point). */
function f(n: number): string {
  if (!Number.isFinite(n)) return '0.0'
  const s = n.toString()
  return /[.eE]/.test(s) ? s : `${s}.0`
}

/**
 * World→local rotation as a column-major GLSL `mat3` literal. A quat rotates
 * local→world; to bring a world point into the child's local frame we need the
 * transpose, which — because GLSL `mat3(...)` is column-major — is exactly the
 * rows of the rotation matrix laid out in order.
 */
function mat3TransposeLiteral(q: Quat): string {
  const [x, y, z, w] = q
  const r00 = 1 - 2 * (y * y + z * z)
  const r01 = 2 * (x * y - w * z)
  const r02 = 2 * (x * z + w * y)
  const r10 = 2 * (x * y + w * z)
  const r11 = 1 - 2 * (x * x + z * z)
  const r12 = 2 * (y * z - w * x)
  const r20 = 2 * (x * z - w * y)
  const r21 = 2 * (y * z + w * x)
  const r22 = 1 - 2 * (x * x + y * y)
  return `mat3(${[r00, r01, r02, r10, r11, r12, r20, r21, r22].map(f).join(', ')})`
}

/** Recursively emit a GLSL distance expression from `node`, evaluated at the
 * point given by the GLSL expression `p`. */
function emit(node: SdfNode, p: string): string {
  switch (node.kind) {
    case 'sphere':
      return `sdSphere(${p}, ${f(node.r)})`
    case 'box':
      return `sdBox(${p}, vec3(${f(node.half[0])}, ${f(node.half[1])}, ${f(node.half[2])}))`
    case 'roundBox': {
      const b = node.half.map((h) => Math.max(h - node.radius, 0))
      return `sdRoundBox(${p}, vec3(${f(b[0])}, ${f(b[1])}, ${f(b[2])}), ${f(node.radius)})`
    }
    case 'cylinder':
      return `sdCyl(${p}, ${f(node.radius)}, ${f(node.height)})`
    case 'torus':
      return `sdTorus(${p}, ${f(node.major)}, ${f(node.minor)})`
    case 'plane':
      return `sdPlane(${p}, vec3(${f(node.normal[0])}, ${f(node.normal[1])}, ${f(node.normal[2])}), ${f(node.offset)})`
    case 'union':
      return `opU(${emit(node.a, p)}, ${emit(node.b, p)})`
    case 'subtract':
      return `opS(${emit(node.a, p)}, ${emit(node.b, p)})`
    case 'intersect':
      return `opI(${emit(node.a, p)}, ${emit(node.b, p)})`
    case 'smoothUnion':
      return `opSU(${emit(node.a, p)}, ${emit(node.b, p)}, ${f(node.k)})`
    case 'smoothSubtract':
      return `opSS(${emit(node.a, p)}, ${emit(node.b, p)}, ${f(node.k)})`
    case 'smoothIntersect':
      return `opSI(${emit(node.a, p)}, ${emit(node.b, p)}, ${f(node.k)})`
    case 'transform': {
      const t = node.translate
      const pt = `((${mat3TransposeLiteral(node.rotate)} * (${p} - vec3(${f(t[0])}, ${f(t[1])}, ${f(t[2])}))) * ${f(1 / node.scale)})`
      return `(${emit(node.child, pt)} * ${f(node.scale)})`
    }
  }
}

/** Shared GLSL primitive/op library — the SAME formulas as `eval.ts`. */
export const SDF_GLSL_LIB = /* glsl */ `
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdCyl(vec3 p, float r, float h){ vec2 d = vec2(length(p.xz) - r, abs(p.y) - h * 0.5); return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))); }
float sdTorus(vec3 p, float R, float r){ vec2 q = vec2(length(p.xz) - R, p.y); return length(q) - r; }
float sdPlane(vec3 p, vec3 n, float o){ return dot(p, normalize(n)) + o; }
float opU(float a, float b){ return min(a, b); }
float opS(float a, float b){ return max(a, -b); }
float opI(float a, float b){ return max(a, b); }
float opSU(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float opSS(float a, float b, float k){ float h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0); return mix(a, -b, h) + k * h * (1.0 - h); }
float opSI(float a, float b, float k){ float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
`

/** Full GLSL for the scene's distance function: the shared lib + a `map`. */
export function sdfToGlsl(node: SdfNode): string {
  return `${SDF_GLSL_LIB}\nfloat map(vec3 p){ return ${emit(node, 'p')}; }\n`
}
