# NeoCad

Web-based, physics-aware hardware design sandbox. Lets anyone model hardware ideas by
assembling real-world stock (rods, joists, panels) with real-world fasteners
(welds, bolts, hinges, axles, ropes) and watching it behave under live physics.
Audience (first): makers/tinkerers who intend to build. UI uses real-world vocabulary,
never abstract geometry/physics jargon.

## Picking up on another device

1. `git clone https://github.com/brainpulp/neocad.git && cd neocad`
2. `npm install`
3. Tell Claude: **"Read CLAUDE.md and pick up where we left off."**

## ⚠️ Branch `m-transform` is SUPERSEDED — do not resume it

The builder-UX milestone (below) re-implemented m-transform's goals directly on `main`
with a different design (drag-first + pause-gizmo instead of always-on PivotControls).
The `m-transform` branch remains only as reference; delete it when convenient.

## Two-stage vision

- **Stage 1 (in progress):** physics-aware builder's sandbox. Rigid-body only.
  Ambient physics with pause-to-model. Document = source of truth; physics = a
  disposable, pluggable *evaluation* of it (soft-body/FEA are future evaluators).
- **Stage 2 (deferred, own spec):** AI-assisted natural-language → manufacturable
  design, validated against Stage 1's constraint framework.

Spec: `docs/superpowers/specs/2026-06-17-neocad-stage1-design.md`
Plans: `docs/superpowers/plans/` · Backlog: `docs/BACKLOG.md`

## Status

- **M1 (playful building) — DONE & verified.** Place stock from a palette into a live
  Jolt world, held-piece placement (inert until released), play/pause/reset, materials,
  IndexedDB autosave + file save/open. See `docs/superpowers/plans/M1-verification-notes.md`.
- **M2 (stable structures) — DONE & verified.** Rigid fasteners (weld/glue/bolt/nail) →
  Jolt fixed constraints; **proximity fastening** (Ring 1 affordance — click a piece onto
  another to auto-weld, no palette hunt); selection + editable Properties; materials editor;
  fastener markers; glTF/STL export. See `docs/superpowers/plans/M2-verification-notes.md`.
- **M2.5 (builder UX quick wins) — DONE & verified.** Delete pieces/fasteners, scene tree
  (select + delete), keyboard shortcuts (Delete/Esc/Ctrl+Z/Y), empty-state hint, fastener
  count in status bar. See `docs/superpowers/plans/M2.5-verification-notes.md`.
- **M-BuilderUX4 (modifiers, forces, arcs, inspector) — DONE & browser-verified.**
  Alt BEFORE click = drag a duplicate (drag survives the world rebuild); Alt DURING
  drag = rotate in place (+Shift tilts about camera-right); dimension EXTENSION LINES
  with end ticks during resize; joint tool reverts to Move after each joint; recovery
  ladder (Put back / 🧹 Tidy / Adopt pose); wind (tips structures — pushes above the
  midline), earthquake, spacebar slingshot (rocks on LAYER_PROJECTILE fly over the
  sandbox walls; walls still contain pieces); velocity caps + softer Baumgarte;
  TransformControls REPLACED by custom per-axis rotation arcs (RotateArcs.tsx) that
  live on the bounding-box shell with the resize handles — no more gizmo fights;
  joint inspector (flip axis / swap ends / numeric limits); procedural material
  textures (render/textures.ts, canvas-generated, color multiplies through).
- **M-BuilderUX3 (direct-manipulation polish) — DONE & browser-verified.** Corner resize
  handles anchor the OPPOSITE corner (Tinkercad-style) with live cm dimension bubbles;
  a lift cone raises/lowers pieces; rotate rings are always on while paused (no gizmo
  modes); paused body-drag moves pieces — jointed pieces move ALONG their joint only
  (slide within end stops / swing around the pivot axis) so users align motion after
  joining; Shift while dragging lifts vertically; thin selection outline; view cube
  (drei GizmoViewcube); zoom-extents (⛶ Fit, window event `neocad:fit`); linear joints
  slide IN the mated face plane (not along the normal) and a JointEditor widget (select
  a joint marker / tree row while paused) drags end-stop limits and re-aims the axis
  on screen; sandbox workbench slab (Document.ground.sandbox, size slider when nothing
  selected) with invisible walls so physics can't fling pieces away; capped drag speed
  + clamped throw velocity; "Fix" affordance (pin in tree, F key); material/strength-
  aware procedural impact sounds (WebAudio + Jolt ContactListenerJS, 🔊 toggle);
  undo/redo bump worldEpoch so restored poses actually apply.
- **M-BuilderUX2 (feature joints, resize handles, slider inspector) — DONE & browser-verified.**
  Joints snap to part FEATURES (bore/centerline/ends/edges/face centers — see
  `document/features.ts`), suggest their type from the pairing (bore→cylindrical,
  edge→pivot, face+face→linear), and ALIGN the loose piece so anchors coincide before
  constraining (`document/joints.ts` planJoint — no yank on Run). Linear/cylindrical
  joints get slide END STOPS from the guide piece's extent (a gear can't fall off its
  axle). Fastened pairs don't contact-collide (Jolt GroupFilterTable). Tinkercad-style
  white resize handles (base corners = plan resize, top = height, base-fixed) live
  alongside the Move/Rotate gizmo when paused; whole-gesture = one undo (transient API).
  Inspector uses labeled cm sliders (Length/Width/Height/Radius/Thickness/Teeth).
  Dev-only `window.__neocadStore` + `window.__camera` power Playwright e2e checks.
- **M-BuilderUX (drag, gizmo, joints, mechanical stock) — DONE, needs hands-on feel pass.**
  Tinkercad-style presentation (white bg, soft hemisphere+key lighting, light grid, orbit
  clamped above ground); selection = orange inverted-hull outline (shading untouched);
  default tool drags pieces across the canvas while the sim runs (kinematic grab, throwable)
  and becomes a move/rotate/scale TransformControls gizmo when paused; dropping stock onto a
  piece opens an attach dialog (weld/glue/bolt/nail, pivot/cylindrical/linear, or none —
  physics pauses while it's open); Joint tool places point A → type → point B joints
  (pivot=hinge, linear=slider, cylindrical=6-DOF) with piece-local anchors; mechanical
  stock (gear/pinion/ratchet/cam/pulley/axle/pin) with real silhouettes, cylinder collision.
- **Guidance Rings 2 & 3 — NOT STARTED.** Spec §13 amendment added a guidance layer; M2
  shipped Ring 1 (proximity) only. Ring 2 (rule-based nudges) then Ring 3 (LLM "what do you
  want to make?", needs the §12 backend-key decision) are a later **Guidance milestone**.
- **M3 (mechanisms) — PARTIALLY LANDED via M-BuilderUX.** Hinge/slider/cylindrical shipped
  as joints. Remaining: ball/rope fasteners, motors (axle/wheel), gear-mesh physics,
  pulley + driven-cart demos, incremental physics-world updates.

## Tech stack

Vite + React + TypeScript · Three.js + @react-three/fiber + @react-three/drei ·
Jolt physics **used directly** via `jolt-physics` (`JoltPhysics.js`), NOT the alpha
`react-three-jolt` wrapper · Zustand (document store) · Vitest + Testing Library ·
static build → GitHub Pages.

## Architecture (key files)

- `src/document/` — the source-of-truth document (`math.ts` = three-free vec/quat helpers).
  - `types.ts` — Document (Definition + State), Piece, Material, Ground.
  - `catalog.ts` — real-world STOCK → engine primitive mapping + `makePiece`.
  - `document.ts` / `store.ts` — pure ops + Zustand store (undo/redo, activeTool, running, reset).
  - `serialize.ts` — `.neocad.json` round-trip + version migration.
- `src/physics/` — **bespoke integration layer (the riskiest code).**
  - `jolt.ts` — WASM init + collision-layer boilerplate.
  - `shapes.ts` — primitive → Jolt shape (convex radius 0 for thin stock).
  - `integration.ts` — `PhysicsWorld`: compile doc → Jolt bodies/constraints,
    **fixed-dt** step (`1/60`, for determinism), sync transforms back into State only.
- `src/render/` — `Scene.tsx` (Canvas + physics loop in `useFrame`), `PieceMesh.tsx`,
  `HeldPiece.tsx` (ghost placement), `geometry.ts`, `snap.ts`.
- `src/ui/` — `App.tsx` shell, `Toolbar`, `Palette`, `Properties`, `StatusBar`, `storeContext`.
- `src/persistence/` — `autosave.ts` (IndexedDB), `file.ts` (download/open `.neocad.json`, `downloadBlob`).
- `src/export/` — `scene.ts` (document → throwaway Three.Group), `exporters.ts` (glTF/STL).
- Fasteners: `document/catalog.ts` `FASTENERS` (rigid → `fixed`), `physics/integration.ts`
  compiles them to Jolt `FixedConstraint`s; `render/proximity.ts` + `HeldPiece`/`Scene` drive
  the proximity affordance; `render/FastenerMarker.tsx` shows joins.

## Conventions / gotchas

- **Selection signal is an outline, never shading** (`PieceMesh` inverted hull; orange =
  selected, green = proximity/joint target).
- **Joint fasteners store anchors/axis in piece-LOCAL space**; `integration.ts` converts to
  world at compile time using current State, so rebuilds stay consistent after motion.
- **Gizmo commits must bump `worldEpoch`** (`movePieceTransform`) or the paused Jolt body
  keeps the old pose and Run snaps the piece back.
- **Joint clicks snap to features; the CLICKED point is not the anchor.** Mechanical
  parts have real bore holes — a ray through the hole hits nothing (e2e scripts must
  aim at the disc, not the center).
- **Directly-fastened pairs don't collide** (GroupFilterTable) — required because
  mechanical stock collides as solid cylinders.

- **Physics is ambient.** `running` defaults true; Pause freezes stepping.
- **State sync mutates pieces in place** every frame and must NOT go through undo/redo —
  only structural Definition edits are undoable.
- **Determinism depends on fixed dt** (`1/60`) — never pass real frame dt to `step`.
- Three.js skips invisible meshes when raycasting — the held-piece catcher plane is
  transparent (opacity 0), not `visible={false}`.
- Physics world fully rebuilds on structural change (keyed by `structureKey + worldEpoch`);
  incremental add/remove is a later optimization.

## Commands

- `npm run dev` — dev server (Vite).
- `npm test` — Vitest (96 tests; includes deterministic physics scenarios).
- `npm run build` — production build → `dist/`.
- Deploy: push to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages).
  Enable Pages → "GitHub Actions" in repo settings once.

## Workflow note

This project is being built with the superpowers skills: brainstorm → write spec →
write plan → execute plan (TDD, frequent commits) → verify in a real browser before
claiming done. Continue M2 by invoking the writing-plans skill against the Stage 1 spec.
