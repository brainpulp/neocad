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
import { MECHANISMS } from './mechanisms'
import { worldDirToLocal, worldToLocal } from './math'
import { snapToFeature, suggestJoint, type JointFeature } from './features'
import { halfExtentAlong, planJoint } from './joints'

/** Interaction tools. 'transform' drags pieces (sim running) or shows a gizmo (paused). */
export type Tool = 'transform' | 'joint' | 'rope' | 'blower'

/** Test-force generators + slingshot options. Session state, never persisted. */
export interface EnvSettings {
  windOn: boolean
  /** N per m² of piece silhouette. */
  windStrength: number
  /** ×6 wind multiplier — demolition weather. */
  hurricane: boolean
  /** Radians, compass direction the wind blows toward. */
  windAngle: number
  quakeOn: boolean
  /** Horizontal shake acceleration, m/s². */
  quakeMagnitude: number
  /** Slingshot rock speed (m/s) and radius (m); Space fires while running. */
  rockSpeed: number
  rockRadius: number
  /** Blower tool force (N) at the cone center. */
  blowStrength: number
}

export interface PendingJoin {
  /** The just-dropped piece. */
  pieceId: string
  /** The piece it was dropped onto. */
  targetId: string
  /** World-space contact point of the drop. */
  point: Vec3
  /** Attach option the feature pairing suggests (highlighted in the dialog). */
  suggested: FastenerType
}

export interface JointAnchor {
  pieceId: string
  /** Snapped joint feature, piece-local (world pose derived from live State). */
  feature: JointFeature
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
  /** Selected fastener (joint editing widget); mutually exclusive with piece selection. */
  selectedFastenerId: string | null
  selectFastener: (id: string | null) => void
  /** Live joint edits (limit-handle drags): no undo spam; endTransient closes the gesture. */
  updateFastenerTransient: (id: string, patch: Partial<import('./types').Fastener>) => void
  /** Commit a fastener edit as one undo entry (e.g. axis re-pick). */
  updateFastener: (id: string, patch: Partial<import('./types').Fastener>) => void
  /** Resize the sandbox workbench (transient-friendly; commit via endTransient). */
  setSandboxSizeTransient: (size: number) => void
  /** Piece currently being dragged across the canvas (disables orbit while set). */
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  /** Joint type used by the joint tool for the next created joint. */
  jointType: JointType
  setJointType: (t: JointType) => void
  /** First point picked in the joint tool's A → type → B flow. */
  jointA: JointAnchor | null
  /** Feature the pointer is hovering with the joint tool (snap preview). */
  jointHover: JointAnchor | null
  /** Update the snap preview for a pointer position over a piece (null clears). */
  jointHoverAt: (pieceId: string | null, point?: Vec3) => void
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
  /** Force a physics-world rebuild (e.g. after a transient joint-limit edit). */
  bumpWorldEpoch: () => void
  /** Impact sound effects on/off. */
  soundOn: boolean
  setSoundOn: (on: boolean) => void
  /** Session-only environment generators (not saved with the document). */
  env: EnvSettings
  setEnv: (patch: Partial<EnvSettings>) => void
  /** Reset every piece's live State back to its Definition and rebuild physics. */
  reset: () => void
  addPiece: (piece: Piece) => void
  updatePiece: (id: string, patch: Partial<Piece>) => void
  removePiece: (id: string) => void
  /** Clone a piece in place (Alt-drag duplicate). Returns the clone, already committed. */
  duplicatePiece: (id: string) => Piece | null
  /** Drop a prebuilt mechanism into the scene (one undo entry). */
  insertMechanism: (id: string) => void
  /** First endpoint picked with the rope tool. */
  ropeStart: { point: Vec3; attach: import('./types').RopeAttachment | null } | null
  /** Rope tool click: first sets the start, second creates the rope. */
  ropeClick: (point: Vec3, attach: import('./types').RopeAttachment | null) => void
  selectedRopeId: string | null
  selectRope: (id: string | null) => void
  updateRope: (id: string, patch: Partial<import('./types').Rope>) => void
  removeRope: (id: string) => void
  /** Put the given pieces back at their rest placement (state ← definition). */
  resetPieces: (ids: string[]) => void
  /** Reset only pieces knocked far from their rest placement; the rest stay settled. */
  tidy: () => void
  /** Adopt the current physical pose as the new rest placement (definition ← state). */
  adoptPose: (ids: string[]) => void
  /**
   * Commit a gizmo edit: sets both Definition and State to the new pose and rebuilds
   * the physics world so paused bodies match (otherwise Run would snap the piece back).
   */
  movePieceTransform: (id: string, transform: Transform) => void
  undo: () => void
  redo: () => void
  /**
   * Transient edits (slider drags): update the doc live without spamming undo.
   * beginTransient snapshots once; endTransient pushes that snapshot as ONE
   * undo entry covering the whole gesture.
   */
  beginTransient: () => void
  updatePieceTransient: (id: string, patch: Partial<Piece>) => void
  endTransient: () => void
  removeFastener: (id: string) => void
  addMaterial: (material: Material) => void
  updateMaterial: (name: string, patch: Partial<Material>) => void
  /** Replace the whole document (Open / autosave restore). Clears history. */
  loadDoc: (doc: Document) => void
}

/**
 * Lift any piece whose lowest point ended up inside the workbench slab (or below
 * the ground) back onto the surface. Runs when paused edit gestures commit, so a
 * resize/move can't leave a piece interpenetrating — Run would fling or trap it.
 */
export function clampAboveSlab(doc: Document): Document {
  const sb = doc.ground.sandbox
  let changed = false
  const pieces = doc.pieces.map((p) => {
    const lift = (t: Transform): Transform | null => {
      const down = worldDirToLocal({ position: [0, 0, 0], rotation: t.rotation }, [0, 1, 0])
      const half = halfExtentAlong(p, down)
      const onSlab =
        sb != null &&
        Math.abs(t.position[0]) <= sb.size / 2 &&
        Math.abs(t.position[2]) <= sb.size / 2
      const floor = onSlab ? sb.thickness : 0
      const delta = floor - (t.position[1] - half)
      if (delta <= 1e-4) return null
      return {
        position: [t.position[0], t.position[1] + delta, t.position[2]],
        rotation: t.rotation,
      }
    }
    const def = lift(p.definition.transform)
    const st = lift(p.state.transform)
    if (!def && !st) return p
    changed = true
    return {
      ...p,
      definition: def ? { transform: def } : p.definition,
      state: st ? { ...p.state, transform: st } : p.state,
    }
  })
  return changed ? { ...doc, pieces } : doc
}

export type DocStore = ReturnType<typeof createDocStore>

export function createDocStore(initial: Document = emptyDocument()) {
  // Sim state to restore after a drop dialog closes (the dialog pauses physics so
  // the dropped piece can't drift away while the user decides).
  let resumeAfterJoin = false
  // Whether the user explicitly picked a joint type (suggestions stop overriding).
  let jointTypeExplicit = false
  // Undo snapshot for an in-flight transient gesture (slider drag).
  let transientPast: Document | null = null
  let ropeCounter = 0
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
      setTool: (tool) => {
        jointTypeExplicit = false
        set({
          tool,
          activeTool: null,
          fastenTool: null,
          pendingFastenA: null,
          jointA: null,
          jointHover: null,
          ropeStart: null,
        })
      },
      selectedFastenerId: null,
      selectFastener: (selectedFastenerId) =>
        set(selectedFastenerId ? { selectedFastenerId, selectedId: null } : { selectedFastenerId }),
      updateFastenerTransient: (id, patch) =>
        set((s) => ({ doc: ops.updateFastener(s.doc, id, patch) })),
      updateFastener: (id, patch) => {
        commit((doc) => ops.updateFastener(doc, id, patch))
        set((s) => ({ worldEpoch: s.worldEpoch + 1 }))
      },
      setSandboxSizeTransient: (size) =>
        set((s) => ({
          doc: {
            ...s.doc,
            ground: {
              ...s.doc.ground,
              sandbox: { thickness: 0.05, ...s.doc.ground.sandbox, size },
            },
          },
        })),
      draggingId: null,
      setDraggingId: (draggingId) => set({ draggingId }),
      jointType: 'pivot',
      // The joint tool suggests a type from the snapped features; an explicit
      // pick in the toolbar wins until the tool is re-selected.
      setJointType: (jointType) => {
        jointTypeExplicit = true
        set({ jointType })
      },
      jointA: null,
      jointHover: null,
      jointHoverAt: (pieceId, point) => {
        if (!pieceId || !point) {
          if (get().jointHover) set({ jointHover: null })
          return
        }
        const piece = get().doc.pieces.find((p) => p.id === pieceId)
        if (!piece) return
        const feature = snapToFeature(piece, worldToLocal(piece.state.transform, point))
        set({ jointHover: { pieceId, feature } })
      },
      jointClick: (pieceId, point) => {
        const { tool, jointType, jointA, doc } = get()
        if (tool !== 'joint') return
        const piece = doc.pieces.find((p) => p.id === pieceId)
        if (!piece) return
        const feature = snapToFeature(piece, worldToLocal(piece.state.transform, point))
        if (!jointA || jointA.pieceId === pieceId) {
          // First pick (or re-picking point A on the same piece).
          const patch: Partial<DocState> = { jointA: { pieceId, feature } }
          if (!jointTypeExplicit) {
            const sug = suggestJoint(feature)
            if (sug !== 'weld') patch.jointType = sug
          }
          set(patch)
          return
        }
        const pieceA = doc.pieces.find((p) => p.id === jointA.pieceId)
        if (!pieceA) {
          set({ jointA: null })
          return
        }
        let type = jointType
        if (!jointTypeExplicit) {
          const sug = suggestJoint(jointA.feature, feature)
          if (sug !== 'weld') type = sug
        }
        // Move the loose piece so the two features coincide (axes aligned),
        // THEN constrain — the joint starts satisfied instead of yanking on Run.
        const plan = planJoint(pieceA, jointA.feature, piece, feature, type, nextFastenerId())
        commit((d) => {
          let next = d
          if (plan.moverId && plan.moverTransform) {
            next = ops.updatePiece(next, plan.moverId, {
              definition: { transform: structuredClone(plan.moverTransform) },
              state: { transform: structuredClone(plan.moverTransform) },
            })
          }
          return ops.addFastener(next, plan.fastener)
        })
        // Joint placed: hand control straight back to the drag/Move tool.
        set((s) => ({
          jointA: null,
          jointHover: null,
          jointType: type,
          tool: 'transform',
          worldEpoch: s.worldEpoch + 1,
        }))
      },
      cancelJoint: () => set({ jointA: null, jointHover: null }),
      pendingJoin: null,
      resolveJoin: (type) => {
        const { pendingJoin, doc } = get()
        if (!pendingJoin) return
        const a = doc.pieces.find((p) => p.id === pendingJoin.pieceId)
        const b = doc.pieces.find((p) => p.id === pendingJoin.targetId)
        if (type && a && b) {
          if (isJointType(type)) {
            // Drop-created joints snap to features too: a gear dropped on an
            // axle slides onto the axle's centerline, not a guessed point.
            const featA = snapToFeature(a, worldToLocal(a.state.transform, pendingJoin.point))
            const featB = snapToFeature(b, worldToLocal(b.state.transform, pendingJoin.point))
            const plan = planJoint(a, featA, b, featB, type, nextFastenerId())
            commit((d) => {
              let next = d
              if (plan.moverId && plan.moverTransform) {
                next = ops.updatePiece(next, plan.moverId, {
                  definition: { transform: structuredClone(plan.moverTransform) },
                  state: { transform: structuredClone(plan.moverTransform) },
                })
              }
              return ops.addFastener(next, plan.fastener)
            })
            set((s) => ({ worldEpoch: s.worldEpoch + 1 }))
          } else {
            commit((d) =>
              ops.addFastener(d, {
                id: nextFastenerId(),
                type,
                partA: pendingJoin.pieceId,
                partB: pendingJoin.targetId,
              }),
            )
          }
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
          // The snapped feature pairing picks the dialog's suggested option.
          resumeAfterJoin = running
          const target = get().doc.pieces.find((p) => p.id === proximityTarget)
          const featA = snapToFeature(piece, worldToLocal(piece.state.transform, position))
          const suggested = target
            ? suggestJoint(featA, snapToFeature(target, worldToLocal(target.state.transform, position)))
            : 'weld'
          set({
            activeTool: null,
            proximityTarget: null,
            running: false,
            pendingJoin: { pieceId: piece.id, targetId: proximityTarget, point: position, suggested },
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
      bumpWorldEpoch: () => set((s) => ({ worldEpoch: s.worldEpoch + 1 })),
      soundOn: true,
      setSoundOn: (soundOn) => set({ soundOn }),
      env: {
        windOn: false,
        windStrength: 6,
        hurricane: false,
        windAngle: 0,
        quakeOn: false,
        quakeMagnitude: 3,
        rockSpeed: 8,
        rockRadius: 0.06,
        blowStrength: 80,
      },
      setEnv: (patch) => set((s) => ({ env: { ...s.env, ...patch } })),
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
      select: (selectedId) =>
        set(selectedId ? { selectedId, selectedFastenerId: null } : { selectedId }),
      addPiece: (piece) => commit((doc) => ops.addPiece(doc, piece)),
      duplicatePiece: (id) => {
        const src = get().doc.pieces.find((p) => p.id === id)
        if (!src) return null
        const clone = makePiece(src.stockType, [...src.state.transform.position])
        clone.name = src.name
        clone.material = src.material
        clone.dimensions = { ...src.dimensions }
        clone.definition = { transform: structuredClone(src.state.transform) }
        clone.state = { transform: structuredClone(src.state.transform) }
        commit((doc) => ops.addPiece(doc, clone))
        set({ selectedId: clone.id })
        return clone
      },
      ropeStart: null,
      ropeClick: (point, attach) => {
        const { ropeStart } = get()
        if (!ropeStart) {
          set({ ropeStart: { point, attach } })
          return
        }
        const dist = Math.hypot(
          point[0] - ropeStart.point[0],
          point[1] - ropeStart.point[1],
          point[2] - ropeStart.point[2],
        )
        if (dist < 0.02) return // same spot; keep waiting for a real endpoint
        ropeCounter += 1
        const rope: import('./types').Rope = {
          id: `rope_${ropeCounter}`,
          name: 'Rope',
          start: [...ropeStart.point],
          end: [...point],
          segments: Math.min(48, Math.max(8, Math.round(dist / 0.06))),
          radius: 0.012,
          slack: 1.15,
          stiffness: 0.9,
          looped: false,
          attachStart: ropeStart.attach,
          attachEnd: attach,
          material: 'hemp',
        }
        commit((doc) => ops.addRope(doc, rope))
        set({ ropeStart: null, tool: 'transform', selectedRopeId: rope.id })
      },
      selectedRopeId: null,
      selectRope: (selectedRopeId) =>
        set(
          selectedRopeId
            ? { selectedRopeId, selectedId: null, selectedFastenerId: null }
            : { selectedRopeId },
        ),
      updateRope: (id, patch) => commit((doc) => ops.updateRope(doc, id, patch)),
      removeRope: (id) =>
        set((s) => ({
          doc: ops.removeRope(s.doc, id),
          past: [...s.past, structuredClone(s.doc)],
          future: [],
          selectedRopeId: s.selectedRopeId === id ? null : s.selectedRopeId,
        })),
      insertMechanism: (id) => {
        const def = MECHANISMS.find((m) => m.id === id)
        if (!def) return
        const { pieces, fasteners } = def.build()
        commit((doc) => ({
          ...doc,
          pieces: [...doc.pieces, ...pieces],
          fasteners: [...doc.fasteners, ...fasteners],
        }))
      },
      resetPieces: (ids) =>
        set((s) => ({
          doc: {
            ...s.doc,
            pieces: s.doc.pieces.map((p) =>
              ids.includes(p.id)
                ? { ...p, state: { transform: structuredClone(p.definition.transform) } }
                : p,
            ),
          },
          worldEpoch: s.worldEpoch + 1,
        })),
      tidy: () => {
        const { doc, resetPieces } = get()
        const displaced = doc.pieces.filter((p) => {
          const d = p.definition.transform.position
          const st = p.state.transform.position
          const dist = Math.hypot(st[0] - d[0], st[1] - d[1], st[2] - d[2])
          // Quaternion dot near ±1 = same orientation.
          const qd = Math.abs(
            p.definition.transform.rotation.reduce((acc, v, i) => acc + v * p.state.transform.rotation[i], 0),
          )
          return dist > 0.15 || qd < 0.94 // ~20°
        })
        if (displaced.length) resetPieces(displaced.map((p) => p.id))
      },
      adoptPose: (ids) =>
        commit((doc) => ({
          ...doc,
          pieces: doc.pieces.map((p) =>
            ids.includes(p.id)
              ? { ...p, definition: { transform: structuredClone(p.state.transform) } }
              : p,
          ),
        })),
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
          // Depenetrate from the slab so the committed pose is physically valid.
          clampAboveSlab(
            ops.updatePiece(doc, id, {
              definition: { transform: structuredClone(transform) },
              state: { transform: structuredClone(transform) },
            }),
          ),
        )
        // Rebuild so the (paused) physics body adopts the new pose.
        set((s) => ({ worldEpoch: s.worldEpoch + 1 }))
      },
      // Undo/redo rebuild the physics world (worldEpoch) so restored poses take
      // effect — otherwise live bodies keep their positions and it looks like
      // nothing happened.
      undo: () =>
        set((s) => {
          if (s.past.length === 0) return s
          const previous = s.past[s.past.length - 1]
          return {
            doc: previous,
            past: s.past.slice(0, -1),
            future: [structuredClone(s.doc), ...s.future],
            worldEpoch: s.worldEpoch + 1,
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
            worldEpoch: s.worldEpoch + 1,
          }
        }),
      beginTransient: () =>
        set((s) => (transientPast ? {} : ((transientPast = structuredClone(s.doc)), {}))),
      updatePieceTransient: (id, patch) => set((s) => ({ doc: ops.updatePiece(s.doc, id, patch) })),
      endTransient: () =>
        set((s) => {
          if (!transientPast) return {}
          const snapshot = transientPast
          transientPast = null
          // A resize (or shrinking sandbox) can leave pieces inside the slab;
          // sweep them back onto the surface as part of the same gesture.
          const clamped = clampAboveSlab(s.doc)
          return {
            doc: clamped,
            past: [...s.past, snapshot],
            future: [],
            ...(clamped !== s.doc ? { worldEpoch: s.worldEpoch + 1 } : {}),
          }
        }),
      removeFastener: (id) => commit((doc) => ops.removeFastener(doc, id)),
      addMaterial: (material) => commit((doc) => ops.addMaterial(doc, material)),
      updateMaterial: (name, patch) => commit((doc) => ops.updateMaterial(doc, name, patch)),
      loadDoc: (doc) => set({ doc, past: [], future: [] }),
    }
  })
}
