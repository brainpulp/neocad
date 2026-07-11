import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Matrix4, Vector3, type ShaderMaterial } from 'three'
import { SDF_GLSL_LIB } from './glsl'

/**
 * Dev-only INTERACTIVE SDF fillet playground at `?sdf`. A drilled block where
 * the outer EDGE fillet and the bore RIM fillet are live sliders — the thing
 * manifold-3d (exact mesh CSG) can't do but implicit SDFs do natively (smooth
 * subtract + rounding). Raymarched, so it re-shades instantly with no meshing;
 * the fillet radii are UNIFORMS, so dragging doesn't recompile the shader.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// SDF scene as a parametric map() over uniforms (same formulas as glsl.ts lib):
// a round-edged box with a smooth-subtracted bore = filleted edges + filleted rim.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uCamPos;
uniform mat4 uInvViewProj;
uniform float uBlock;   // half-size
uniform float uBore;    // bore radius
uniform float uEdgeR;   // outer edge fillet
uniform float uRimR;    // bore rim fillet

${SDF_GLSL_LIB}

float map(vec3 p) {
  float er = clamp(uEdgeR, 0.0, uBlock * 0.98);
  float box = sdRoundBox(p, vec3(uBlock - er), er);
  float bore = sdCyl(p, uBore, uBlock * 2.0 + 1.0);
  return opSS(box, bore, max(uRimR, 0.0002));
}

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
  vec3 ro = uCamPos, rd = normalize(farP.xyz - nearP.xyz);
  float t = 0.0; bool hit = false;
  for (int i = 0; i < 160; i++) {
    float d = map(ro + rd * t);
    if (d < 0.001) { hit = true; break; }
    t += d; if (t > 60.0) break;
  }
  if (!hit) { gl_FragColor = vec4(mix(vec3(0.90,0.92,0.95), vec3(0.82,0.86,0.91), vUv.y), 1.0); return; }
  vec3 p = ro + rd * t, n = calcNormal(p);
  float diff = clamp(dot(n, normalize(vec3(0.6,0.85,0.5))), 0.0, 1.0);
  float amb = 0.4 + 0.25 * (0.5 + 0.5 * n.y);
  vec3 col = vec3(0.85,0.55,0.24) * (amb + diff * 0.85);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}
`

function Raymarcher({
  block,
  bore,
  edgeR,
  rimR,
}: {
  block: number
  bore: number
  edgeR: number
  rimR: number
}) {
  const matRef = useRef<ShaderMaterial>(null)
  const { camera } = useThree()
  const invVP = useMemo(() => new Matrix4(), [])
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    return g
  }, [])
  const uniforms = useMemo(
    () => ({
      uCamPos: { value: new Vector3() },
      uInvViewProj: { value: new Matrix4() },
      uBlock: { value: block },
      uBore: { value: bore },
      uEdgeR: { value: edgeR },
      uRimR: { value: rimR },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // Push slider values into uniforms (no shader recompile).
  uniforms.uBlock.value = block
  uniforms.uBore.value = bore
  uniforms.uEdgeR.value = edgeR
  uniforms.uRimR.value = rimR

  useFrame(() => {
    const m = matRef.current
    if (!m) return
    invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert()
    m.uniforms.uInvViewProj.value.copy(invVP)
    m.uniforms.uCamPos.value.copy(camera.position)
  })
  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <shaderMaterial ref={matRef} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

const labelCss: React.CSSProperties = { display: 'block', marginTop: 10, fontSize: 12, opacity: 0.9 }
function Slider({ name, value, min, max, step, onChange }: { name: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={labelCss}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 92 }}>{name}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ width: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
      </div>
    </label>
  )
}

export function SdfApp() {
  const [block, setBlock] = useState(1)
  const [dia, setDia] = useState(0.9)
  const [edgeR, setEdgeR] = useState(0.12)
  const [rimR, setRimR] = useState(0.12)
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e9edf2' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 10,
          width: 250,
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #cdd6e0',
          borderRadius: 8,
          color: '#33465c',
          font: '13px/1.4 system-ui, sans-serif',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        }}
      >
        <strong>NeoCad · SDF fillets</strong>
        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>raymarched · smooth ops, live</div>
        <Slider name="Block" value={block} min={0.6} max={1.5} step={0.02} onChange={setBlock} />
        <Slider name="Bore Ø" value={dia} min={0.1} max={1.6} step={0.02} onChange={setDia} />
        <Slider name="Edge fillet" value={edgeR} min={0} max={0.5} step={0.01} onChange={setEdgeR} />
        <Slider name="Rim fillet" value={rimR} min={0} max={0.5} step={0.01} onChange={setRimR} />
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
          exact cuts → <code>?csg</code> · fillets are SDF-only
        </div>
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.55 }}>drag to orbit · scroll to zoom</div>
      </div>
      <Canvas camera={{ position: [3.0, 2.3, 3.4], fov: 45 }}>
        <Raymarcher block={block} bore={dia / 2} edgeR={edgeR} rimR={rimR} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
