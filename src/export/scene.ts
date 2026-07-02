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
import { wedgeGeometry } from '../render/mechanical'
import { STOCK } from '../document/catalog'
import type { Document, Piece } from '../document/types'

const FALLBACK_COLOR = '#cccccc'

function geometryObject(piece: Piece): BufferGeometry {
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
 */
export function buildExportScene(doc: Document): Group {
  const group = new Group()
  for (const piece of doc.pieces) {
    const color = doc.materials.find((m) => m.name === piece.material)?.color ?? FALLBACK_COLOR
    const mesh = new Mesh(geometryObject(piece), new MeshStandardMaterial({ color }))
    const [px, py, pz] = piece.state.transform.position
    const [qx, qy, qz, qw] = piece.state.transform.rotation
    mesh.position.set(px, py, pz)
    mesh.quaternion.set(qx, qy, qz, qw)
    mesh.name = piece.name
    group.add(mesh)
  }
  return group
}
