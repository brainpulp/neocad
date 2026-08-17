import * as THREE from 'three'
import type { VisualKind } from '../document/catalog'

/**
 * Visual geometry for mechanical stock. These are looks-right builder shapes —
 * physics still collides them as plain cylinders (see catalog.ts). All builders
 * return geometry whose spin axis is +Y, matching CylinderGeometry, so the same
 * piece transform works for both.
 */

/** Extrude a 2D outline (in the XZ "top view" plane) to `thickness` along Y. */
function extrudeFlat(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  })
  geo.translate(0, 0, -thickness / 2)
  geo.rotateX(Math.PI / 2) // extrusion axis z → y
  geo.computeVertexNormals()
  return geo
}

function axleHole(radius: number): THREE.Path {
  const hole = new THREE.Path()
  hole.absarc(0, 0, radius, 0, Math.PI * 2, true)
  return hole
}

/** Spur gear: trapezoidal teeth around a root circle, with an axle hole. */
export function gearGeometry(radius: number, thickness: number, teeth: number): THREE.BufferGeometry {
  const n = Math.max(4, Math.round(teeth))
  const tip = radius
  const root = radius * 0.82
  const step = (Math.PI * 2) / n
  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = i * step
    // Tooth occupies the first half of the step; the rest is root land.
    const p = (f: number, r: number) => [Math.cos(a + f * step) * r, Math.sin(a + f * step) * r] as const
    const [x0, y0] = p(0, root)
    if (i === 0) shape.moveTo(x0, y0)
    else shape.lineTo(x0, y0)
    shape.lineTo(...p(0.12, tip))
    shape.lineTo(...p(0.38, tip))
    shape.lineTo(...p(0.5, root))
  }
  shape.closePath()
  shape.holes.push(axleHole(radius * 0.18))
  return extrudeFlat(shape, thickness)
}

/** Ratchet wheel: sawtooth profile (gradual rise, sharp drop), with an axle hole. */
export function ratchetGeometry(radius: number, thickness: number, teeth: number): THREE.BufferGeometry {
  const n = Math.max(3, Math.round(teeth))
  const tip = radius
  const root = radius * 0.78
  const step = (Math.PI * 2) / n
  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = i * step
    const x = (f: number, r: number) => Math.cos(a + f * step) * r
    const y = (f: number, r: number) => Math.sin(a + f * step) * r
    if (i === 0) shape.moveTo(x(0, root), y(0, root))
    else shape.lineTo(x(0, root), y(0, root))
    // Rise to the tip across the tooth, then drop straight back to the root.
    shape.lineTo(x(0.85, tip), y(0.85, tip))
    shape.lineTo(x(1, root), y(1, root))
  }
  shape.closePath()
  shape.holes.push(axleHole(radius * 0.2))
  return extrudeFlat(shape, thickness)
}

/**
 * Eccentric cam: a disc whose axle hole is offset from center by `lobe`,
 * so it pushes a follower once per revolution.
 */
export function camGeometry(radius: number, thickness: number, lobe: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  const offset = Math.min(Math.abs(lobe), radius * 0.6)
  hole.absarc(-offset, 0, radius * 0.22, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  return extrudeFlat(shape, thickness)
}

/** Pulley: solid of revolution with a V-groove for a rope/belt around the rim. */
export function pulleyGeometry(radius: number, thickness: number): THREE.BufferGeometry {
  const h = thickness / 2
  const hub = radius * 0.18
  const groove = radius * 0.7
  const pts = [
    new THREE.Vector2(hub, -h),
    new THREE.Vector2(radius, -h),
    new THREE.Vector2(radius, -h * 0.6),
    new THREE.Vector2(groove, 0), // groove bottom
    new THREE.Vector2(radius, h * 0.6),
    new THREE.Vector2(radius, h),
    new THREE.Vector2(hub, h),
  ]
  const geo = new THREE.LatheGeometry(pts, 32)
  geo.computeVertexNormals()
  return geo
}

/**
 * Right-triangular prism matching the physics hull (shapes.ts): base rectangle
 * at y = -y/2, apex edge along z at x = -x/2, y = +y/2. Non-indexed so the
 * flat faces shade crisply; box-projected UVs so material textures apply.
 */
export function wedgeGeometry(dx: number, dy: number, dz: number): THREE.BufferGeometry {
  const hx = dx / 2
  const hy = dy / 2
  const hz = dz / 2
  const A = [-hx, -hy, -hz]
  const B = [hx, -hy, -hz]
  const C = [hx, -hy, hz]
  const D = [-hx, -hy, hz]
  const E = [-hx, hy, -hz]
  const F = [-hx, hy, hz]
  // Wound so every face's normal points outward.
  const tris = [
    [A, B, C], [A, C, D], // bottom (-y)
    [A, D, F], [A, F, E], // back (-x)
    [B, E, F], [B, F, C], // slope (+x+y)
    [A, E, B], // end (-z)
    [D, C, F], // end (+z)
  ]
  const positions = new Float32Array(tris.length * 9)
  const uvs = new Float32Array(tris.length * 6)
  tris.forEach((tri, i) => {
    // Face normal decides the UV projection plane (box mapping).
    const [u, v] = ((): [number, number] => {
      const [p, q, r] = tri
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
      const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ].map(Math.abs)
      if (n[1] >= n[0] && n[1] >= n[2]) return [0, 2] // y-facing → xz
      if (n[0] >= n[2]) return [2, 1] // x-facing → zy
      return [0, 1] // z-facing → xy
    })()
    tri.forEach((p, j) => {
      positions.set(p, i * 9 + j * 3)
      uvs.set([p[u] + 0.5, p[v] + 0.5], i * 6 + j * 2)
    })
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  return geo
}

export function buildVisual(kind: VisualKind, d: Record<string, number>): THREE.BufferGeometry {
  switch (kind) {
    case 'gear':
      return gearGeometry(d.radius, d.height, d.teeth ?? 16)
    case 'ratchet':
      return ratchetGeometry(d.radius, d.height, d.teeth ?? 12)
    case 'cam':
      return camGeometry(d.radius, d.height, d.lobe ?? d.radius * 0.5)
    case 'pulley':
      return pulleyGeometry(d.radius, d.height)
  }
}
