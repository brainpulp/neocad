import { createStore } from 'zustand/vanilla'
import { emptyDocument, type Document, type Piece } from './types'
import * as ops from './document'

export interface DocState {
  doc: Document
  past: Document[]
  future: Document[]
  /** Whether physics is currently advancing (ambient mode). Pause sets this false. */
  running: boolean
  setRunning: (running: boolean) => void
  addPiece: (piece: Piece) => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  removePiece: (id: string) => void
  undo: () => void
  redo: () => void
  /** Replace the whole document (Open / autosave restore). Clears history. */
  loadDoc: (doc: Document) => void
}

export type DocStore = ReturnType<typeof createDocStore>

export function createDocStore(initial: Document = emptyDocument()) {
  return createStore<DocState>((set) => {
    // Apply a structural Definition edit, pushing the prior doc onto the undo stack.
    const commit = (next: (doc: Document) => Document) =>
      set((s) => ({
        doc: next(s.doc),
        past: [...s.past, structuredClone(s.doc)],
        future: [],
      }))

    return {
      doc: initial,
      past: [],
      future: [],
      running: true,
      setRunning: (running) => set({ running }),
      addPiece: (piece) => commit((doc) => ops.addPiece(doc, piece)),
      updatePiece: (id, patch) => commit((doc) => ops.updatePiece(doc, id, patch)),
      removePiece: (id) => commit((doc) => ops.removePiece(doc, id)),
      undo: () =>
        set((s) => {
          if (s.past.length === 0) return s
          const previous = s.past[s.past.length - 1]
          return {
            doc: previous,
            past: s.past.slice(0, -1),
            future: [structuredClone(s.doc), ...s.future],
          }
        }),
      redo: () =>
        set((s) => {
          if (s.future.length === 0) return s
          const nextDoc = s.future[0]
          return {
            doc: nextDoc,
            past: [...s.past, structuredClone(s.doc)],
            future: s.future.slice(1),
          }
        }),
      loadDoc: (doc) => set({ doc, past: [], future: [] }),
    }
  })
}
