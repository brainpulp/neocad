import type { Document, Piece } from './types'

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
  return { ...doc, pieces: doc.pieces.filter((p) => p.id !== id) }
}
