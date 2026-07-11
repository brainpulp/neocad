import { describe, it, expect } from 'vitest'
import { sdfToGlsl } from '../../src/sdf/glsl'
import { box, cylinder, sphere, subtract, translate, union } from '../../src/sdf/tree'

describe('sdfToGlsl', () => {
  it('emits a map() over the shared primitive/op library', () => {
    const src = sdfToGlsl(sphere(1))
    expect(src).toContain('float sdSphere(')
    expect(src).toContain('float map(vec3 p)')
    expect(src).toContain('sdSphere(p, 1.0)')
  })

  it('maps ops to their GLSL op helpers', () => {
    const src = sdfToGlsl(subtract(box([1, 1, 1]), cylinder(0.5, 3)))
    expect(src).toContain('opS(') // subtract → opS
    expect(src).toContain('sdBox(')
    expect(src).toContain('sdCyl(')
  })

  it('inlines a transform as a mat3 * (p - t) point remap', () => {
    const src = sdfToGlsl(union(sphere(1), translate([2, 0, 0], sphere(1))))
    expect(src).toContain('opU(')
    expect(src).toContain('mat3(')
    expect(src).toContain('vec3(2.0, 0.0, 0.0)') // the translate literal
  })

  it('formats integer literals as GLSL floats', () => {
    expect(sdfToGlsl(sphere(2))).toContain('2.0')
  })
})
