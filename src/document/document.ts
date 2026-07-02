import type { Document, Fastener, Material, Piece, Rope } from './types'

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
    // Ropes tied to the removed piece just come loose.
    ropes: (doc.ropes ?? []).map((r) => ({
      ...r,
      attachStart: r.attachStart?.pieceId === id ? null : r.attachStart,
      attachEnd: r.attachEnd?.pieceId === id ? null : r.attachEnd,
    })),
  }
}

export function addRope(doc: Document, rope: Rope): Document {
  return { ...doc, ropes: [...(doc.ropes ?? []), rope] }
}

export function updateRope(doc: Document, id: string, patch: Partial<Rope>): Document {
  return { ...doc, ropes: (doc.ropes ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }
}

export function removeRope(doc: Document, id: string): Document {
  return { ...doc, ropes: (doc.ropes ?? []).filter((r) => r.id !== id) }
}

export function addFastener(doc: Document, fastener: Fastener): Document {
  return { ...doc, fasteners: [...doc.fasteners, fastener] }
}

export function removeFastener(doc: Document, id: string): Document {
  return { ...doc, fasteners: doc.fasteners.filter((f) => f.id !== id) }
}

export function updateFastener(doc: Document, id: string, patch: Partial<Fastener>): Document {
  return {
    ...doc,
    fasteners: doc.fasteners.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  }
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
