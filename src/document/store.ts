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
import { makePiece, nextFastenerId, pieceVolume } from './catalog'
import { MECHANISMS } from './mechanisms'
import { worldDirToLocal, worldToLocal } from './math'
import { snapToFeature, suggestJoint, type JointFeature } from './features'
import {
  halfExtentAlong,
  jointFrame,
  planJoint,
  rotatePieceAboutAxis,
  slidePieceAlongAxis,
} from './joints'

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
  /**
   * Adjust a joint by MOVING the loose piece about/along the joint axis
   * (Onshape-style angle/offset): `rotate` in radians about the axis through the
   * anchor, `slide` in metres along it. This actually relocates the part.
   */
  adjustJoint: (id: string, opts: { rotate?: number; slide?: number }) => void
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
  /** Multi-selection (selectedId is the primary/last-clicked member). */
  selectedIds: string[]
  /** Shift-click: add/remove a piece from the selection. */
  toggleSelect: (id: string) => void
  /** Marquee: replace the whole selection at once. */
  selectMany: (ids: string[]) => void
  /** Marquee rectangle in client coords while dragging one (UI overlay). */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  setMarquee: (m: { x0: number; y0: number; x1: number; y1: number } | null) => void
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
  /** Delete several pieces (multi-select) as one undo entry. */
  removePieces: (ids: string[]) => void
  /** Clone a piece in place (Alt-drag duplicate). Returns the clone, already committed. */
  duplicatePiece: (id: string) => Piece | null
  /** Drop a prebuilt mechanism into the scene at the origin (tests/back-compat). */
  insertMechanism: (id: string) => void
  /** Mechanism chosen from the palette, awaiting a click to place it (ghost follows cursor). */
  placingMechanismId: string | null
  setPlacingMechanism: (id: string | null) => void
  /** Place the pending mechanism at a ground position (one undo entry). */
  placeMechanismAt: (position: Vec3) => void
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
  /** Remove a fastener because physics snapped it (no undo entry). */
  breakFastener: (id: string) => void
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
export function clampAboveSlab(doc: Document, onlyIds?: string[]): Document {
  const sb = doc.ground.sandbox
  let changed = false
  const pieces = doc.pieces.map((p) => {
    // Clamp ONLY the edited pieces: sweeping the whole doc pops bystanders —
    // e.g. a piece settled half off the bench edge (bottom below slab top,
    // center still on the bench) would teleport upward on every unrelated edit.
    if (onlyIds && !onlyIds.includes(p.id)) return p
    const lift = (t: Transform): Transform | null => {
      const rot = { position: [0, 0, 0] as Vec3, rotation: t.rotation }
      const half = halfExtentAlong(p, worldDirToLocal(rot, [0, 1, 0]))
      // Rest on the slab if the piece's FOOTPRINT overlaps it — not just its
      // centre. A big cylinder whose centre sits just past the bench edge still
      // overhangs onto the slab; clamping it to the ground buried that overhang
      // 5 cm into the stage (the "clipping to stage" bug). Physics tips a real
      // overhang off when the sim runs; the clamp just keeps it out of the slab.
      const hx = halfExtentAlong(p, worldDirToLocal(rot, [1, 0, 0]))
      const hz = halfExtentAlong(p, worldDirToLocal(rot, [0, 0, 1]))
      const overlapsSlab =
        sb != null &&
        Math.abs(t.position[0]) - hx < sb.size / 2 &&
        Math.abs(t.position[2]) - hz < sb.size / 2
      const floor = overlapsSlab ? sb.thickness : 0
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
      adjustJoint: (id, opts) => {
        const doc = get().doc
        const f = doc.fasteners.find((x) => x.id === id)
        if (!f) return
        const a = doc.pieces.find((p) => p.id === f.partA)
        const b = doc.pieces.find((p) => p.id === f.partB)
        if (!a || !b) return
        // Move the loose piece (both free → the smaller, matching the joint mover).
        const move =
          !a.anchored && (b.anchored || pieceVolume(a) <= pieceVolume(b))
            ? a
            : !b.anchored
              ? b
              : null
        if (!move) return
        const { pivot, axis } = jointFrame(f, a)
        let tr = move.state.transform
        if (opts.rotate) tr = rotatePieceAboutAxis({ ...move, state: { transform: tr } }, pivot, axis, opts.rotate)
        if (opts.slide) tr = slidePieceAlongAxis({ ...move, state: { transform: tr } }, axis, opts.slide)
        get().movePieceTransform(move.id, tr)
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
      setActiveTool: (activeTool) =>
        set({ activeTool, fastenTool: null, pendingFastenA: null, placingMechanismId: null }),
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
      selectedIds: [],
      select: (selectedId) =>
        set(
          selectedId
            ? { selectedId, selectedIds: [selectedId], selectedFastenerId: null }
            : { selectedId, selectedIds: [] },
        ),
      toggleSelect: (id) =>
        set((s) => {
          const has = s.selectedIds.includes(id)
          const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
          return {
            selectedIds,
            selectedId: has ? (selectedIds[selectedIds.length - 1] ?? null) : id,
            selectedFastenerId: null,
          }
        }),
      selectMany: (ids) =>
        set({
          selectedIds: ids,
          selectedId: ids[ids.length - 1] ?? null,
          selectedFastenerId: null,
        }),
      marquee: null,
      setMarquee: (marquee) => set({ marquee }),
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
        set({ selectedId: clone.id, selectedIds: [clone.id] })
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
          stiffness: 1,
          elasticity: 0, // real rope: inextensible by default
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
        const { pieces, fasteners, ropes } = def.build()
        commit((doc) => {
          // Mechanisms are authored around the origin; dropping one INTO an
          // existing build makes the solver explode everything apart. Shift
          // the whole assembly to clear ground beside what's already there.
          let dx = 0
          if (doc.pieces.length > 0) {
            const near = doc.pieces.some(
              (p) =>
                Math.abs(p.state.transform.position[0]) < 1.2 &&
                Math.abs(p.state.transform.position[2]) < 1.2,
            )
            if (near) {
              const maxX = Math.max(...doc.pieces.map((p) => p.state.transform.position[0]))
              dx = maxX + 1.3
            }
          }
          if (dx !== 0) {
            for (const p of pieces) {
              p.definition.transform.position[0] += dx
              p.state.transform.position[0] += dx
            }
            for (const r of ropes ?? []) {
              r.start[0] += dx
              r.end[0] += dx
            }
          }
          return {
            ...doc,
            pieces: [...doc.pieces, ...pieces],
            fasteners: [...doc.fasteners, ...fasteners],
            ropes: [...(doc.ropes ?? []), ...(ropes ?? [])],
          }
        })
      },
      placingMechanismId: null,
      setPlacingMechanism: (placingMechanismId) =>
        set({ placingMechanismId, activeTool: null, fastenTool: null }),
      placeMechanismAt: (position) => {
        const id = get().placingMechanismId
        const def = MECHANISMS.find((m) => m.id === id)
        if (!def) return
        const { pieces, fasteners, ropes } = def.build()
        // Builds are authored around the origin; shift the whole assembly to the
        // clicked spot (XZ only — Y is the bench-relative height it was built at).
        const dx = position[0]
        const dz = position[2]
        for (const p of pieces) {
          p.definition.transform.position[0] += dx
          p.definition.transform.position[2] += dz
          p.state.transform.position[0] += dx
          p.state.transform.position[2] += dz
        }
        for (const r of ropes ?? []) {
          r.start[0] += dx
          r.start[2] += dz
          r.end[0] += dx
          r.end[2] += dz
          if (r.attachStart) {
            /* piece-local anchors need no shift */
          }
        }
        commit((doc) => ({
          ...doc,
          pieces: [...doc.pieces, ...pieces],
          fasteners: [...doc.fasteners, ...fasteners],
          ropes: [...(doc.ropes ?? []), ...(ropes ?? [])],
        }))
        set({ placingMechanismId: null })
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
          selectedIds: s.selectedIds.filter((x) => x !== id),
        })),
      removePieces: (ids) =>
        set((s) => ({
          doc: ids.reduce((d, id) => ops.removePiece(d, id), s.doc),
          past: [...s.past, structuredClone(s.doc)],
          future: [],
          selectedId: ids.includes(s.selectedId ?? '') ? null : s.selectedId,
          selectedIds: s.selectedIds.filter((x) => !ids.includes(x)),
        })),
      movePieceTransform: (id, transform) => {
        commit((doc) =>
          // Depenetrate THIS piece from the slab so the committed pose is valid.
          clampAboveSlab(
            ops.updatePiece(doc, id, {
              definition: { transform: structuredClone(transform) },
              state: { transform: structuredClone(transform) },
            }),
            [id],
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
          // A resize can push the edited piece into the slab — sweep it out as
          // part of the same gesture. Only pieces the gesture actually touched
          // are clamped (whole-doc sweeps pop bystanders); a sandbox change is
          // the exception, since the slab itself moved under everything.
          const sandboxChanged =
            (snapshot.ground.sandbox?.size ?? 0) !== (s.doc.ground.sandbox?.size ?? 0) ||
            (snapshot.ground.sandbox?.thickness ?? 0) !== (s.doc.ground.sandbox?.thickness ?? 0)
          const touched = s.doc.pieces
            .filter((p) => {
              const before = snapshot.pieces.find((x) => x.id === p.id)
              return !before || before !== p
            })
            .map((p) => p.id)
          const clamped = clampAboveSlab(s.doc, sandboxChanged ? undefined : touched)
          return {
            doc: clamped,
            past: [...s.past, snapshot],
            future: [],
            ...(clamped !== s.doc ? { worldEpoch: s.worldEpoch + 1 } : {}),
          }
        }),
      removeFastener: (id) => commit((doc) => ops.removeFastener(doc, id)),
      // A snapped bond is a physics EVENT, not an edit: no undo entry. The doc
      // change re-keys the world, which rebuilds without the constraint.
      breakFastener: (id) =>
        set((s) => ({
          doc: ops.removeFastener(s.doc, id),
          selectedFastenerId: s.selectedFastenerId === id ? null : s.selectedFastenerId,
        })),
      addMaterial: (material) => commit((doc) => ops.addMaterial(doc, material)),
      updateMaterial: (name, patch) => commit((doc) => ops.updateMaterial(doc, name, patch)),
      loadDoc: (doc) => set({ doc, past: [], future: [] }),
    }
  })
}
