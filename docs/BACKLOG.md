# NeoCad Backlog

Living list of work. M-numbers are Stage 1 milestones from the spec
(`docs/superpowers/specs/2026-06-17-neocad-stage1-design.md`).

## Done

- **M1 — Playful building** ✅ (verified 2026-06-17, see `plans/M1-verification-notes.md`)
  - Project scaffold, document model, stock catalog, serialize round-trip, undo/redo store
  - Jolt integration layer (fixed-dt, deterministic), render from State, app shell
  - Held-piece placement, play/pause/reset, IndexedDB autosave, file save/open

- **M2 — Stable structures** ✅ (verified 2026-06-18, see `plans/M2-verification-notes.md`)
  - Rigid fasteners (weld/glue/bolt/nail) → Jolt fixed constraints
  - **Proximity fastening** (Ring 1 affordance) + palette A→B fallback
  - Anchoring via Properties; selection + editable Properties; materials editor
  - Fastener markers; glTF/STL export; fastener count in status bar

- **M2.5 — Builder UX quick wins** ✅ (verified 2026-06-18, see `plans/M2.5-verification-notes.md`)
  - Delete pieces/fasteners, scene tree (select+delete), keyboard shortcuts, empty-state

## Next up — M-Transform (direct manipulation)

Spec: `specs/2026-06-18-neocad-builder-ux-design.md` (M-Transform section). Needs a plan.
- Tinkercad-style move/rotate/scale gizmo (bounding-box handles) on the selected piece
- Inline editable dimensions (click a label, type exact size)
- Auto-pause-on-grab (default) + a "✋ Grab" live-intervene toggle
- Scale maps to `dimensions`; move snaps to grid; commits to Definition

## Next up — M-Snap (a real snapping system)

Placement and drag are free-floating today (stock rests on the surface under the
cursor, joints snap only at the moment of joining). Makers expect things to *click
together* as they move them. Build a first-class snap system:
- **Grid snap** — translation snaps to a settable grid (default off-grid free; the
  fixed 0.1 m grid mentioned in tech debt should become user-controllable).
- **Feature/face snap** — while dragging a piece, highlight and snap to nearby faces,
  edges, ends, bores, and centerlines of other pieces (reuse `document/features.ts`
  candidates) so parts seat flush without a joint.
- **Angle snap** — rotation snaps to 15° (already in the rotate ring); extend to
  drag-rotate and make the increment settable.
- **Snap-to-piece surfaces** — dropping/moving a piece onto another lands it ON the
  surface (co-planar), not intersecting — the placement ghost should preview the snap.
- **Controls in the UI** — grid size, snap on/off, angle increment (currently all
  hardcoded). A modifier (e.g. hold Ctrl) temporarily disables snapping for free placement.
- **Visual feedback** — snap guides/indicators (alignment lines, highlighted target
  feature) so the user sees WHAT they're snapping to before releasing.

## Later — Guidance milestone (Rings 2 & 3) OR M3 (mechanisms)

Guidance (from spec §13 amendment):
- **Ring 2 — rule-based nudges** (offline, deterministic): a small rules engine reads doc
  state and surfaces one contextual nudge at a time ("4 legs placed, nothing joined — …").
- **Ring 3 — LLM intent layer**: "what do you want to make?", propose→confirm→execute→adjust,
  constrained to parametric recipes (not freeform geometry). Needs the §12 backend-key
  decision (bring-your-own-key vs thin serverless proxy) — Rings 1–2 must work with no key.

## Later — M3: Mechanisms

- Articulated fasteners: **hinge** (revolute), **slider** (prismatic), **ball/pin**, **rope/cable**
- **Motors**: powered hinge/slider (axle/wheel) with targetVelocity + maxForce
- Demos: pulley lifting a weight; driven cart on a ramp
- Incremental physics-world updates (avoid full rebuild on every structural change)
- Rope state serialization (define node-position vs rest-length representation)

## Cross-cutting / tech debt

- Code-split / lazy-load the ~4MB Jolt WASM (currently one big chunk)
- Scene-tree panel listing all pieces; click-to-select in viewport
- Selection model (currently Properties is a stub; no real selection yet)
- Snap controls (grid size, toggle) surfaced in UI (currently fixed 0.1m)
- Friendlier first-run (empty-state hint to pick a stock)

## Stage 2 (separate spec, deferred)

- AI-assisted natural-language → design, validated by the constraint framework
- Future evaluators on the same document: soft-body deformation, FEA stress/failure
  (materials table already reserves youngsModulus/yieldStrength/poissonRatio)
