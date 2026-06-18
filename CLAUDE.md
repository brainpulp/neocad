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

## ⚠️ RESUMING M-TRANSFORM (current in-flight work)

The latest work (the Tinkercad-style transform gizmo) is on branch **`m-transform`**, which is
**pushed but NOT merged to `main`**. `main` ends at M2.5.

To continue it on another device:
1. `git fetch && git checkout m-transform && npm install`
2. `npm run dev` → open the app.
3. **Hands-on check the gizmo (the part automation couldn't verify):**
   - Place a Block → click it → the gizmo appears. Drag the colored handles to move / raise /
     rotate / scale. Physics should auto-pause while dragging and resume on release; the new
     pose & size should persist (and be undoable).
   - Click an **inline dimension label** (floats above the piece) and type an exact value.
   - Toggle **✋ Grab** in the toolbar, press **Run**, and drag a piece around while it
     simulates (it goes kinematic and shoves neighbors); release → it falls again.
4. If it feels right → `git checkout main && git merge --no-ff m-transform && git push`, then
   update this file's status + memory. If it needs tuning, likely spots: gizmo size
   (`scale={95}` fixed, in `src/render/TransformGizmo.tsx`), rotation/scale snap, the inline
   dimension-label click target (`src/render/DimensionLabels.tsx`).
   - **Known dev quirk:** editing gizmo code + HMR can corrupt the R3F canvas — just refresh
     the page. Fresh loads are clean (not a production bug).

After M-Transform lands, the agreed sequence is: **Guidance Ring 2 → Ring 3 → M3 mechanisms.**

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
- **M-Transform (direct manipulation) — CODE-COMPLETE on branch `m-transform`, NOT MERGED,
  awaiting hands-on verification.** Tinkercad-style move/rotate/scale gizmo (drei
  `PivotControls`), inline editable dimension labels, `✋ Grab` live-intervene (kinematic drag
  while running), auto-pause-on-grab, scale→dimensions, drift-guarded commit. 68 tests pass.
  **The drag interaction itself was NOT auto-verifiable** (R3F reads `offsetX`, which synthetic
  pointer events can't set) — needs a real mouse. See **"RESUMING M-TRANSFORM"** below and
  `docs/superpowers/plans/M-Transform-verification-notes.md`.
- **Guidance Rings 2 & 3 — NOT STARTED.** Spec §13 amendment added a guidance layer; M2
  shipped Ring 1 (proximity) only. Ring 2 (rule-based nudges) then Ring 3 (LLM "what do you
  want to make?", needs the §12 backend-key decision) are a later **Guidance milestone**.
- **M3 (mechanisms) — NOT STARTED.** Hinge/slider/ball/rope fasteners, motors
  (axle/wheel), pulley + driven-cart demos, incremental physics-world updates.

## Tech stack

Vite + React + TypeScript · Three.js + @react-three/fiber + @react-three/drei ·
Jolt physics **used directly** via `jolt-physics` (`JoltPhysics.js`), NOT the alpha
`react-three-jolt` wrapper · Zustand (document store) · Vitest + Testing Library ·
static build → GitHub Pages.

## Architecture (key files)

- `src/document/` — the source-of-truth document.
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
  `HeldPiece.tsx` (ghost placement), `geometry.ts`, `snap.ts`. M-Transform adds:
  `TransformGizmo.tsx` (PivotControls move/rotate/scale, auto-pause, drift-guarded commit),
  `transform.ts` (pure matrix→document-patch + scale→dimensions), `DimensionLabels.tsx`
  (inline editable dims), `proximity.ts`, `FastenerMarker.tsx`, `EmptyState.tsx`.
- `src/ui/` — `App.tsx` shell (also installs the global keyboard handler), `Toolbar`
  (Run/Pause, Reset, ✋ Grab, Undo/Redo, Save/Open, glTF/STL), `Palette` (Stock + Fasteners),
  `Properties` (editable), `MaterialsEditor`, `SceneTree`, `StatusBar`, `keyboard.ts`,
  `storeContext`.
- `src/persistence/` — `autosave.ts` (IndexedDB), `file.ts` (download/open `.neocad.json`, `downloadBlob`).
- `src/export/` — `scene.ts` (document → throwaway Three.Group), `exporters.ts` (glTF/STL).
- Fasteners: `document/catalog.ts` `FASTENERS` (rigid → `fixed`), `physics/integration.ts`
  compiles them to Jolt `FixedConstraint`s; `render/proximity.ts` + `HeldPiece`/`Scene` drive
  the proximity affordance; `render/FastenerMarker.tsx` shows joins.

## Conventions / gotchas

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
- `npm test` — Vitest (68 tests; includes deterministic physics scenarios + transform/UI logic).
- `npm run build` — production build → `dist/`.
- Deploy: push to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages).
  Enable Pages → "GitHub Actions" in repo settings once.

## Workflow note

This project is being built with the superpowers skills: brainstorm → write spec →
write plan → execute plan (TDD, frequent commits) → verify in a real browser before
claiming done. Each milestone runs on its own branch, verified, then merged to `main`.
Immediate next step: hands-on-verify M-Transform (see top of file), merge, then
brainstorm/plan **Guidance Ring 2** against the Stage 1 spec (§13).
