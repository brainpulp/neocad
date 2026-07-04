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
- **Connection points / snap markers (Lego-style)** — beyond geometric snapping,
  parts can carry named **connectors** (stud/socket, tab/slot, plug/port) that snap
  ONLY to compatible connectors on specific other parts. Markers are authored on
  library parts (and addable by the user to any part) with a position, orientation,
  and a mating "kind"; two compatible connectors within range click together and can
  auto-fasten. This is what makes assembling fast — you don't align faces by hand,
  the studs find their sockets. (Data lives on the part definition; the snap solver
  prefers connector-matches over raw geometry snaps.)

## Later — Modeling & sim aids (agreed in joint-process discussion, 2026-07-04)

Workbench-literal helpers. None of these solve the joint process itself — they make
assembling and diagnosing easier around it:
- **Clamps** — temporary holds ("clamp this while I work, release before/on Run"),
  distinct from the permanent Fix property.
- **Tape measure** — click two points/faces → distance (and angle between faces).
- **Clash highlight** — while paused, tint interpenetrating parts red where they
  overlap; passive twin of the joint-time collision veto (same check, always on).
- **Settle** — run physics briefly for ONE selected piece (everything else held) so
  gravity seats it on the surface below; least-abstract alignment tool possible.
- **Slow motion + single-step** — 10% speed toggle and step-one-frame; failures
  happen in 200 ms and are unreadable at full speed. Fixed-dt makes this trivial.
- **Strain coloring** — breakable-bond loads are already computed per step; color
  fastener markers green→yellow→red live so builds show what's about to fail.
- **Hold-to-test** — hold a key: sim runs; release: spring back to build pose.
  One-keystroke try-it/fix-it loop, no Reset / recovery ladder.
- **Center-of-gravity plumb bob** — CG projected on the ground vs the support
  footprint: "will it tip?" answered before running.

## Later — M-Library (rich, visual parts library)

Today the palette is a short text list of stock. Grow it into a real library:
- **Many more shape types** — a broad catalog of stock and primitives (structural
  shapes, panels, rods, brackets, connectors, etc.), organized into categories.
- **Dropdown/browser with thumbnails, not text** — each part shows as a rendered
  thumbnail (small 3D preview or generated icon), so users pick by sight, Tinkercad-style.
- Searchable / filterable; recently-used; favorites.

## Later — M-Parametric (parametric shape generators)

Tinkercad's "Shape Generators" applied to builders: parts defined by parameters that
regenerate geometry live (and, where relevant, physics + connectors):
- **Building elements** — stairs, roof, box (open/closed, wall thickness), pipe,
  fittings (elbow/tee/coupling), windows, doors, frames.
- **Basic mechanisms** — parametric versions of the mechanism library (gear with N
  teeth, rack, hinge assembly, etc.).
- Each exposes editable parameters in the inspector; changing a parameter rebuilds
  the shape without losing joints/fasteners where possible. Connectors (see M-Snap)
  can be generated at parametric positions (e.g. stud grid on a plate).

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
