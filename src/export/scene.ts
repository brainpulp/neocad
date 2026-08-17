import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three'
import { geometryFor } from '../render/geometry'
import { hollowGeometry } from '../render/hollowGeometry'
import { wedgeGeometry } from '../render/mechanical'
import { pieceToCsg } from '../document/cuts'
import { csgToGeometry } from '../render/csg'
import { STOCK } from '../document/catalog'
import type { Document, Piece } from '../document/types'

const FALLBACK_COLOR = '#cccccc'

async function geometryObject(piece: Piece): Promise<BufferGeometry> {
  // Drilled pieces export the EXACT hole-punched mesh (so a printed part is
  // really bored, not a solid block). The manifold kernel loads lazily; Node
  // resolves its wasm on disk, the browser via the URL PieceMesh already passes.
  const cut = pieceToCsg(piece)
  if (cut) return csgToGeometry(cut)
  // Hollow pieces export their real walls (so a printed tube is actually hollow).
  const hollow = hollowGeometry(piece)
  if (hollow) return hollow
  const g = geometryFor(STOCK[piece.stockType].primitive, piece.dimensions)
  switch (g.kind) {
    case 'box':
      return new BoxGeometry(...(g.args as [number, number, number]))
    case 'cylinder':
      return new CylinderGeometry(...(g.args as [number, number, number, number]))
    case 'sphere':
      return new SphereGeometry(...(g.args as [number, number, number]))
    case 'wedge':
      return wedgeGeometry(...(g.args as [number, number, number]))
  }
}

/**
 * Build a throwaway Three.js scene from the document's current State, for one-way
 * glTF/STL export. Pure Three (no R3F), so it runs anywhere including tests.
 * Async because drilled pieces are meshed through the manifold WASM kernel.
 */
export async function buildExportScene(doc: Document): Promise<Group> {
  const group = new Group()
  for (const piece of doc.pieces) {
    const color = doc.materials.find((m) => m.name === piece.material)?.color ?? FALLBACK_COLOR
    const mesh = new Mesh(await geometryObject(piece), new MeshStandardMaterial({ color }))
    const [px, py, pz] = piece.state.transform.position
    const [qx, qy, qz, qw] = piece.state.transform.rotation
    mesh.position.set(px, py, pz)
    mesh.quaternion.set(qx, qy, qz, qw)
    mesh.name = piece.name
    group.add(mesh)
  }
  return group
}
