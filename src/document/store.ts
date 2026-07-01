import { createStore } from 'zustand/vanilla'
import {
  emptyDocument,
  isJointType,
  type Document,
  type FastenerType,
  type JointType,
  type Material,
  type Piece,
  type StockType,
  type Transform,
  type Vec3,
} from './types'
import * as ops from './document'
import { makePiece, nextFastenerId } from './catalog'
import { length, normalize, sub, worldDirToLocal, worldToLocal } from './math'

/** Interaction tools. 'transform' drags pieces (sim running) or shows a gizmo (paused). */
export type Tool = 'transform' | 'joint'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface PendingJoin {
  /** The just-dropped piece. */
  pieceId: string
  /** The piece it was dropped onto. */
  targetId: string
  /** World-space contact point of the drop. */
  point: Vec3
}

export interface JointAnchor {
  pieceId: string
  /** World-space clicked point. */
  point: Vec3
}

export interface DocState {
  doc: Document
  past: Document[]
  future: Document[]
  /** Whether physics is currently advancing (ambient mode). Pause sets this false. */
  running: boolean
  setRunning: (running: boolean) => void
  /** Interaction tool. 'transform' is the default (drag / gizmo); 'joint' picks A → type → B. */
  tool: Tool
  setTool: (tool: Tool) => void
  /** Gizmo mode while paused with the transform tool. */
  gizmoMode: GizmoMode
  setGizmoMode: (mode: GizmoMode) => void
  /** Piece currently being dragged across the canvas (disables orbit while set). */
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  /** Joint type used by the joint tool for the next created joint. */
  jointType: JointType
  setJointType: (t: JointType) => void
  /** First point picked in the joint tool's A → type → B flow. */
  jointA: JointAnchor | null
  /** Click a piece at a world point with the joint tool. First click = A, second = B. */
  jointClick: (pieceId: string, point: Vec3) => void
  cancelJoint: () => void
  /** Set when a held piece is dropped onto another: the user picks how to attach. */
  pendingJoin: PendingJoin | null
  /** Resolve the drop dialog: a fastener type joins the pieces; null means no fastener. */
  resolveJoin: (type: FastenerType | null) => void
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
  /**
   * Commit a gizmo edit: sets both Definition and State to the new pose and rebuilds
   * the physics world so paused bodies match (otherwise Run would snap the piece back).
   */
  movePieceTransform: (id: string, transform: Transform) => void
  undo: () => void
  redo: () => void
  removeFastener: (id: string) => void
  addMaterial: (material: Material) => void
  updateMaterial: (name: string, patch: Partial<Material>) => void
  /** Replace the whole document (Open / autosave restore). Clears history. */
  loadDoc: (doc: Document) => void
}

export type DocStore = ReturnType<typeof createDocStore>

export function createDocStore(initial: Document = emptyDocument()) {
  // Sim state to restore after a drop dialog closes (the dialog pauses physics so
  // the dropped piece can't drift away while the user decides).
  let resumeAfterJoin = false
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
      tool: 'transform',
      setTool: (tool) =>
        set({ tool, activeTool: null, fastenTool: null, pendingFastenA: null, jointA: null }),
      gizmoMode: 'translate',
      setGizmoMode: (gizmoMode) => set({ gizmoMode }),
      draggingId: null,
      setDraggingId: (draggingId) => set({ draggingId }),
      jointType: 'pivot',
      setJointType: (jointType) => set({ jointType }),
      jointA: null,
      jointClick: (pieceId, point) => {
        const { tool, jointType, jointA, doc } = get()
        if (tool !== 'joint') return
        if (!jointA) {
          set({ jointA: { pieceId, point } })
          return
        }
        if (jointA.pieceId === pieceId) {
          // Re-picking on the same piece moves point A.
          set({ jointA: { pieceId, point } })
          return
        }
        const pieceA = doc.pieces.find((p) => p.id === jointA.pieceId)
        const pieceB = doc.pieces.find((p) => p.id === pieceId)
        if (!pieceA || !pieceB) {
          set({ jointA: null })
          return
        }
        // The joint axis runs through the two picked points; if they coincide
        // (same spot clicked on both pieces) fall back to world-up.
        const dir = sub(point, jointA.point)
        const axisWorld = length(dir) < 1e-4 ? ([0, 1, 0] as Vec3) : normalize(dir)
        const ta = pieceA.state.transform
        const tb = pieceB.state.transform
        commit((d) =>
          ops.addFastener(d, {
            id: nextFastenerId(),
            type: jointType,
            partA: jointA.pieceId,
            partB: pieceId,
            anchorA: worldToLocal(ta, jointA.point),
            anchorB: worldToLocal(tb, point),
            axisA: worldDirToLocal(ta, axisWorld),
          }),
        )
        set({ jointA: null })
      },
      cancelJoint: () => set({ jointA: null }),
      pendingJoin: null,
      resolveJoin: (type) => {
        const { pendingJoin, doc } = get()
        if (!pendingJoin) return
        const a = doc.pieces.find((p) => p.id === pendingJoin.pieceId)
        const b = doc.pieces.find((p) => p.id === pendingJoin.targetId)
        if (type && a && b) {
          const fastener: import('./types').Fastener = {
            id: nextFastenerId(),
            type,
            partA: pendingJoin.pieceId,
            partB: pendingJoin.targetId,
          }
          if (isJointType(type)) {
            // Drop-created joints anchor at the contact point with a vertical axis;
            // the Joint tool is the precise way to place an axis.
            fastener.anchorA = worldToLocal(a.state.transform, pendingJoin.point)
            fastener.anchorB = worldToLocal(b.state.transform, pendingJoin.point)
            fastener.axisA = worldDirToLocal(a.state.transform, [0, 1, 0])
          }
          commit((d) => ops.addFastener(d, fastener))
        }
        set({ pendingJoin: null, running: resumeAfterJoin })
        resumeAfterJoin = false
      },
      activeTool: null,
      // Stock and fasten tools are mutually exclusive modes.
      setActiveTool: (activeTool) => set({ activeTool, fastenTool: null, pendingFastenA: null }),
      commitHeldAt: (position) => {
        const { activeTool, proximityTarget, fastenTool, running } = get()
        if (!activeTool) return
        const piece = makePiece(activeTool, position)
        if (proximityTarget && fastenTool) {
          // The user pre-picked a fastener in the palette: join immediately with it.
          commit((doc) =>
            ops.addFastener(ops.addPiece(doc, piece), {
              id: nextFastenerId(),
              type: fastenTool,
              partA: piece.id,
              partB: proximityTarget,
            }),
          )
          set({ activeTool: null, proximityTarget: null })
          return
        }
        commit((doc) => ops.addPiece(doc, piece))
        if (proximityTarget) {
          // Dropped onto another piece with no fastener pre-picked: pause physics
          // (so the piece holds still) and ask how — or whether — to attach.
          resumeAfterJoin = running
          set({
            activeTool: null,
            proximityTarget: null,
            running: false,
            pendingJoin: { pieceId: piece.id, targetId: proximityTarget, point: position },
          })
          return
        }
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
      movePieceTransform: (id, transform) => {
        commit((doc) =>
          ops.updatePiece(doc, id, {
            definition: { transform: structuredClone(transform) },
            state: { transform: structuredClone(transform) },
          }),
        )
        // Rebuild so the (paused) physics body adopts the new pose.
        set((s) => ({ worldEpoch: s.worldEpoch + 1 }))
      },
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
      removeFastener: (id) => commit((doc) => ops.removeFastener(doc, id)),
      addMaterial: (material) => commit((doc) => ops.addMaterial(doc, material)),
      updateMaterial: (name, patch) => commit((doc) => ops.updateMaterial(doc, name, patch)),
      loadDoc: (doc) => set({ doc, past: [], future: [] }),
    }
  })
}
