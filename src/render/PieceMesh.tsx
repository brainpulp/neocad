import { forwardRef, useEffect, useMemo } from 'react'
import { type BufferGeometry, type Mesh } from 'three'
import { type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { formatMass, pieceMass } from '../document/catalog'
import { maxExtent, pieceVisual } from './geometry'
import { buildVisual, wedgeGeometry } from './mechanical'
import { hollowGeometry } from './hollowGeometry'
import { textureFor } from './textures'
import type { Material, Piece } from '../document/types'

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
  { piece, materials, selected, onPointerDown, onPointerMove, onPointerUp, onPointerOut },
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

  // The selection/highlight outline is a screen-space edge pass in Scene.tsx
  // (SelectionEffects, postprocessing OutlineEffect) — a true constant-px
  // silhouette that traces corners, the ground edge and hollow openings
  // cleanly. PieceMesh only supplies the geometry it outlines.
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
