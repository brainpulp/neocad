import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Matrix4, type ShaderMaterial } from 'three'
import { sdfToGlsl } from './glsl'
import {
  box,
  cylinder,
  intersect,
  roundBox,
  smoothUnion,
  sphere,
  subtract,
  torus,
  translate,
  type SdfNode,
} from './tree'

/**
 * A handful of showcase trees, switchable from the URL: `?sdf=<name>`.
 * Each exercises a different corner of the core; `blend-bore` is the default.
 */
export const DEMOS: Record<string, { title: string; node: SdfNode }> = {
  'blend-bore': {
    title: 'rounded box + blended sphere − bore',
    node: subtract(
      smoothUnion(roundBox([1, 1, 1], 0.18), translate([1.05, 0.65, 0], sphere(0.72)), 0.35),
      cylinder(0.42, 5),
    ),
  },
  scoop: {
    title: 'box − sphere (a spherical scoop)',
    node: subtract(box([1, 1, 1]), translate([0, 1, 0], sphere(1.15))),
  },
  pipe: {
    title: 'cylinder − cylinder (a tube)',
    node: subtract(cylinder(1, 2.2), cylinder(0.72, 3)),
  },
  dome: {
    title: 'box ∩ sphere (a rounded cap)',
    node: intersect(box([1, 0.6, 1]), sphere(1.15)),
  },
  ring: {
    title: 'torus + smooth-blended bead',
    node: smoothUnion(torus(1, 0.32), translate([1, 0, 0], sphere(0.5)), 0.25),
  },
  dice: {
    title: 'rounded box − pip bores',
    node: [
      [0.55, 0.55],
      [-0.55, 0.55],
      [0.55, -0.55],
      [-0.55, -0.55],
      [0, 0],
    ].reduce<SdfNode>(
      (solid, [x, z]) => subtract(solid, translate([x, 1, z], sphere(0.28))),
      roundBox([1, 1, 1], 0.18),
    ),
  },
}

function pickDemo(): { title: string; node: SdfNode; name: string } {
  const q = new URLSearchParams(window.location.search).get('sdf') || ''
  const name = DEMOS[q] ? q : 'blend-bore'
  return { name, ...DEMOS[name] }
}

// Fullscreen triangle in clip space; the fragment reconstructs camera rays.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const fragmentFor = (node: SdfNode) => /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uCamPos;
uniform mat4 uInvViewProj;

${sdfToGlsl(node)}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(1.0, -1.0) * 0.0006;
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 nearP = uInvViewProj * vec4(ndc, -1.0, 1.0); nearP /= nearP.w;
  vec4 farP = uInvViewProj * vec4(ndc, 1.0, 1.0); farP /= farP.w;
  vec3 ro = uCamPos;
  vec3 rd = normalize(farP.xyz - nearP.xyz);

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    t += d;
    if (t > 60.0) break;
  }

  if (!hit) {
    // Soft vertical gradient background.
    vec3 bg = mix(vec3(0.10, 0.11, 0.14), vec3(0.16, 0.18, 0.22), vUv.y);
    gl_FragColor = vec4(bg, 1.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 nrm = calcNormal(p);
  vec3 key = normalize(vec3(0.6, 0.85, 0.5));
  float diff = clamp(dot(nrm, key), 0.0, 1.0);
  float amb = 0.35 + 0.25 * (0.5 + 0.5 * nrm.y);
  vec3 base = vec3(0.86, 0.55, 0.24);
  vec3 col = base * (amb + diff * 0.85);
  col = pow(col, vec3(0.4545)); // gamma
  gl_FragColor = vec4(col, 1.0);
}
`

function Raymarcher({ node }: { node: SdfNode }) {
  const matRef = useRef<ShaderMaterial>(null)
  const { camera } = useThree()
  const invVP = useMemo(() => new Matrix4(), [])

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    // Oversized triangle covering the screen (-1..3).
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    return g
  }, [])

  const uniforms = useMemo(
    () => ({
      uCamPos: { value: camera.position.clone() },
      uInvViewProj: { value: new Matrix4() },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useFrame(() => {
    const m = matRef.current
    if (!m) return
    invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert()
    m.uniforms.uInvViewProj.value.copy(invVP)
    m.uniforms.uCamPos.value.copy(camera.position)
  })

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={fragmentFor(node)}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

/** Dev-only SDF preview. Reached via `?sdf` (default demo) or `?sdf=<name>`. */
export function SdfApp() {
  const demo = useMemo(() => pickDemo(), [])
  const names = Object.keys(DEMOS)
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 10,
          color: '#cfd6e4',
          font: '13px/1.5 system-ui, sans-serif',
        }}
      >
        <strong>NeoCad · SDF preview</strong>
        <div style={{ opacity: 0.7 }}>
          {demo.name} — {demo.title}
        </div>
        <div style={{ opacity: 0.55, marginTop: 6 }}>
          raymarched · drag to orbit · scroll to zoom
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {names.map((n) => (
            <a
              key={n}
              href={`?sdf=${n}`}
              style={{
                color: n === demo.name ? '#ffcf87' : '#9fb0c8',
                textDecoration: 'none',
                borderBottom: n === demo.name ? '1px solid #ffcf87' : '1px solid transparent',
              }}
            >
              {n}
            </a>
          ))}
        </div>
      </div>
      <Canvas camera={{ position: [3.2, 2.4, 3.6], fov: 45 }}>
        <Raymarcher node={demo.node} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
