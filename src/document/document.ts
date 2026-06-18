import type { Document, Fastener, Material, Piece } from './types'

/** Pure, immutable operations on a Document's Definition. */

export function addPiece(doc: Document, piece: Piece): Document {
  return { ...doc, pieces: [...doc.pieces, piece] }
}

export function updatePiece(doc: Document, id: string, patch: Partial<Piece>): Document {
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }
}

export function removePiece(doc: Document, id: string): Document {
  return {
    ...doc,
    pieces: doc.pieces.filter((p) => p.id !== id),
    // Dangling fasteners referencing a removed piece must go too.
    fasteners: doc.fasteners.filter((f) => f.partA !== id && f.partB !== id),
  }
}

export function addFastener(doc: Document, fastener: Fastener): Document {
  return { ...doc, fasteners: [...doc.fasteners, fastener] }
}

export function removeFastener(doc: Document, id: string): Document {
  return { ...doc, fasteners: doc.fasteners.filter((f) => f.id !== id) }
}

export function addMaterial(doc: Document, material: Material): Document {
  return { ...doc, materials: [...doc.materials, material] }
}

export function updateMaterial(doc: Document, name: string, patch: Partial<Material>): Document {
  return {
    ...doc,
    materials: doc.materials.map((m) => (m.name === name ? { ...m, ...patch } : m)),
  }
}
