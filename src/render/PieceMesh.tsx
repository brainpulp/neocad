import { forwardRef, useEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  PerspectiveCamera,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Mesh,
} from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { formatMass, pieceMass } from '../document/catalog'
import { maxExtent, pieceVisual } from './geometry'
import { buildVisual, wedgeGeometry } from './mechanical'
import { hollowGeometry } from './hollowGeometry'
import { textureFor } from './textures'
import type { Material, Piece } from '../document/types'

const SELECT_COLOR = 0xff8a00 // orange
const HIGHLIGHT_COLOR = 0x2ecc71 // green
const HULL_TMP = new Vector3()

/**
 * Selection/highlight outline as a back-face hull: the piece geometry rendered
 * again inside-out with every vertex pushed OUT along its normal, so a thin
 * shell peeks around the whole silhouette — gear teeth included, with no
 * concave drop-outs (a screen-space normal offset would gap in the notches).
 * The push distance is recomputed each frame from the piece's camera distance
 * so the line stays a constant ~2px at any zoom (the Tinkercad look), and it
 * renders in the normal scene pass (no offscreen buffers).
 */
function OutlineHull({
  geometry,
  color,
  thicknessPx = 2.4,
}: {
  geometry: BufferGeometry
  color: number
  thicknessPx?: number
}) {
  const ref = useRef<Mesh>(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uOffset: { value: 0.01 },
          uColor: { value: new Color(color) },
        },
        vertexShader: /* glsl */ `
          uniform float uOffset;
          void main() {
            vec3 tn = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            mv.xyz += tn * uOffset; // push out along the normal in view space
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          void main() { gl_FragColor = vec4(uColor, 1.0); }
        `,
        side: BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera, size }) => {
    const m = ref.current
    if (!m) return
    const dist = camera.position.distanceTo(m.getWorldPosition(HULL_TMP))
    // World units per screen pixel at this distance (perspective camera).
    const fov = ((camera as PerspectiveCamera).fov ?? 45) * (Math.PI / 180)
    const worldPerPx = (2 * Math.tan(fov / 2) * dist) / size.height
    material.uniforms.uOffset.value = thicknessPx * worldPerPx
  })
  return (
    <mesh ref={ref} geometry={geometry} material={material} renderOrder={2} raycast={() => null} />
  )
}

interface Props {
  piece: Piece
  materials: Material[]
  selected?: boolean
  highlighted?: boolean
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
}

/** Renders one piece. The mesh ref lets the physics loop drive its transform imperatively. */
export const PieceMesh = forwardRef<Mesh, Props>(function PieceMesh(
  {
    piece,
    materials,
    selected,
    highlighted,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerOut,
  },
  ref,
) {
  const v = pieceVisual(piece, materials)
  const mat = materials.find((m) => m.name === piece.material)
  const optics = mat?.optics
  const finish = mat?.finish

  // Mechanical stock renders a custom silhouette (teeth, groove, lobe), the
  // wedge a triangular prism, and a hollow piece its merged wall bricks (same
  // shape physics collides). Rebuilt only when dimensions/hollow change.
  const dimsKey = Object.values(piece.dimensions).join(',')
  const hollowKey = piece.hollow
    ? `${piece.hollow.thickness}:${piece.hollow.openFace ?? ''}`
    : ''
  const customGeo = useMemo<BufferGeometry | null>(
    () =>
      piece.hollow
        ? hollowGeometry(piece) // hollow wins: walls replace the solid shape
        : v.visual
          ? buildVisual(v.visual, piece.dimensions)
          : v.kind === 'wedge'
            ? wedgeGeometry(piece.dimensions.x, piece.dimensions.y, piece.dimensions.z)
            : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.visual, v.kind, dimsKey, hollowKey],
  )
  useEffect(() => () => customGeo?.dispose(), [customGeo])

  // The analytic solid shape (outer box/cylinder/sphere). Used for the SELECTION
  // OUTLINE of hollow pieces so the rim traces the outer silhouette, not the
  // splayed wall shell.
  const analyticGeoJsx = (
    <>
      {v.kind === 'box' && <boxGeometry args={v.args as [number, number, number]} />}
      {v.kind === 'cylinder' && (
        <cylinderGeometry args={v.args as [number, number, number, number]} />
      )}
      {v.kind === 'sphere' && <sphereGeometry args={v.args as [number, number, number]} />}
    </>
  )
  const geometryJsx = customGeo ? (
    <primitive object={customGeo} attach="geometry" />
  ) : (
    analyticGeoJsx
  )

  // Geometry the outline hull traces. A hollow piece outlines its OUTER solid
  // silhouette (box/cylinder), not the wall shell; mechanical/wedge stock reuse
  // their custom silhouette geometry (shared, so no clone); plain stock builds
  // the analytic solid. Only built while the piece is actually outlined.
  const outline = selected || highlighted
  const ownOutlineGeo = useMemo<BufferGeometry | null>(() => {
    if (!outline) return null
    if (customGeo && !piece.hollow) return null // reuse customGeo directly
    if (v.kind === 'box') {
      const [x, y, z] = v.args as [number, number, number]
      return new BoxGeometry(x, y, z)
    }
    if (v.kind === 'cylinder') {
      const [rt, rb, h, seg] = v.args as [number, number, number, number]
      return new CylinderGeometry(rt, rb, h, seg)
    }
    if (v.kind === 'sphere') {
      const [r, ws, hs] = v.args as [number, number, number]
      return new SphereGeometry(r, ws, hs)
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline, v.kind, dimsKey, hollowKey, customGeo, piece.hollow])
  useEffect(() => () => ownOutlineGeo?.dispose(), [ownOutlineGeo])
  const outlineGeo =
    ownOutlineGeo ?? (customGeo && !piece.hollow ? customGeo : null)
  return (
    <mesh
      ref={ref}
      position={v.position}
      quaternion={v.quaternion}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOut={onPointerOut}
    >
      {geometryJsx}
      {optics ? (
        // See-through materials (glass, ice, acrylic): physically-based
        // transmission with a real index of refraction — light bends through
        // the volume instead of a flat alpha fade.
        <meshPhysicalMaterial
          color={v.color}
          transmission={optics.transmission}
          ior={optics.ior ?? 1.5}
          roughness={optics.roughness ?? 0.1}
          thickness={Math.min(0.3, maxExtent(piece) * 0.4)}
          metalness={0}
        />
      ) : finish?.clearcoat ? (
        // Clearcoat finishes (plastics, glazed ceramic, polished marble) need
        // the physical material for the second specular lobe.
        <meshPhysicalMaterial
          color={v.color}
          map={textureFor(piece.material) ?? undefined}
          roughness={finish.roughness ?? 0.5}
          metalness={finish.metalness ?? 0}
          clearcoat={finish.clearcoat}
          clearcoatRoughness={0.15}
        />
      ) : (
        <meshStandardMaterial
          color={v.color}
          map={textureFor(piece.material) ?? undefined}
          // Metals catch the environment; matte families keep the clay-free
          // default. Honest per-material finish, envmap does the rest.
          roughness={finish?.roughness ?? 0.75}
          metalness={finish?.metalness ?? 0.05}
        />
      )}
      {outline && outlineGeo && (
        <OutlineHull
          geometry={outlineGeo}
          color={selected ? SELECT_COLOR : HIGHLIGHT_COLOR}
        />
      )}
      {selected && (
        // Weight chip: real mass floats above the selected piece so relative
        // heft is visible without opening the inspector.
        <Html
          position={[0, maxExtent(piece) / 2 + 0.06, 0]}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="weight-chip">⚖ {formatMass(pieceMass(piece, materials))}</div>
        </Html>
      )}
    </mesh>
  )
})
