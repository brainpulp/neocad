import { createStore } from 'zustand/vanilla'
import {
  emptyDocument,
  type Document,
  type FastenerType,
  type Material,
  type Piece,
  type StockType,
  type Vec3,
} from './types'
import * as ops from './document'
import { makePiece, nextFastenerId } from './catalog'

export interface DocState {
  doc: Document
  past: Document[]
  future: Document[]
  /** Whether physics is currently advancing (ambient mode). Pause sets this false. */
  running: boolean
  setRunning: (running: boolean) => void
  /** The stock tool selected in the palette (held-piece placement), or null. */
  activeTool: StockType | null
  setActiveTool: (tool: StockType | null) => void
  /** Commit the active-tool stock as a piece at the given (already-snapped) position. */
  commitHeldAt: (position: Vec3) => void
  /** Selected fastener tool (mutually exclusive with activeTool); also the proximity join type. */
  fastenTool: FastenerType | null
  setFastenTool: (tool: FastenerType | null) => void
  /** First piece clicked in the explicit A→B fasten fallback. */
  pendingFastenA: string | null
  fastenClick: (pieceId: string) => void
  /** Piece the held ghost is currently near; commit auto-joins to it. */
  proximityTarget: string | null
  setProximityTarget: (id: string | null) => void
  /** Current world position of the held ghost (driven by pointer over ground/pieces). */
  heldPos: Vec3
  setHeldPos: (pos: Vec3) => void
  /** Currently selected piece (transient UI state — not saved, not undoable). */
  selectedId: string | null
  select: (id: string | null) => void
  /** Bumped whenever the physics world must be rebuilt from scratch (e.g. reset). */
  worldEpoch: number
  /** Reset every piece's live State back to its Definition and rebuild physics. */
  reset: () => void
  addPiece: (piece: Piece) => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  removePiece: (id: string) => void
  undo: () => void
  redo: () => void
  addMaterial: (material: Material) => void
  updateMaterial: (name: string, patch: Partial<Material>) => void
  /** Replace the whole document (Open / autosave restore). Clears history. */
  loadDoc: (doc: Document) => void
}

export type DocStore = ReturnType<typeof createDocStore>

export function createDocStore(initial: Document = emptyDocument()) {
  return createStore<DocState>((set, get) => {
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
      activeTool: null,
      // Stock and fasten tools are mutually exclusive modes.
      setActiveTool: (activeTool) => set({ activeTool, fastenTool: null, pendingFastenA: null }),
      commitHeldAt: (position) => {
        const { activeTool, proximityTarget, fastenTool } = get()
        if (!activeTool) return
        const piece = makePiece(activeTool, position)
        const joinType: FastenerType = fastenTool ?? 'weld'
        commit((doc) => {
          let d = ops.addPiece(doc, piece)
          if (proximityTarget) {
            d = ops.addFastener(d, {
              id: nextFastenerId(),
              type: joinType,
              partA: piece.id,
              partB: proximityTarget,
            })
          }
          return d
        })
        set({ activeTool: null, proximityTarget: null })
      },
      fastenTool: null,
      setFastenTool: (fastenTool) => set({ fastenTool, activeTool: null, pendingFastenA: null }),
      pendingFastenA: null,
      fastenClick: (pieceId) => {
        const { fastenTool, pendingFastenA } = get()
        if (!fastenTool) return
        if (!pendingFastenA) {
          set({ pendingFastenA: pieceId })
          return
        }
        if (pendingFastenA === pieceId) return
        commit((doc) =>
          ops.addFastener(doc, { id: nextFastenerId(), type: fastenTool, partA: pendingFastenA, partB: pieceId }),
        )
        set({ pendingFastenA: null })
      },
      proximityTarget: null,
      setProximityTarget: (proximityTarget) => set({ proximityTarget }),
      heldPos: [0, 1.2, 0],
      setHeldPos: (heldPos) => set({ heldPos }),
      worldEpoch: 0,
      reset: () =>
        set((s) => ({
          doc: {
            ...s.doc,
            pieces: s.doc.pieces.map((p) => ({
              ...p,
              state: { transform: structuredClone(p.definition.transform) },
            })),
          },
          worldEpoch: s.worldEpoch + 1,
        })),
      selectedId: null,
      select: (selectedId) => set({ selectedId }),
      addPiece: (piece) => commit((doc) => ops.addPiece(doc, piece)),
      updatePiece: (id, patch) => commit((doc) => ops.updatePiece(doc, id, patch)),
      removePiece: (id) =>
        set((s) => ({
          doc: ops.removePiece(s.doc, id),
          past: [...s.past, structuredClone(s.doc)],
          future: [],
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
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
      addMaterial: (material) => commit((doc) => ops.addMaterial(doc, material)),
      updateMaterial: (name, patch) => commit((doc) => ops.updateMaterial(doc, name, patch)),
      loadDoc: (doc) => set({ doc, past: [], future: [] }),
    }
  })
}
