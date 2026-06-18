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

## ⚠️ In-flight work lives on branch `m-transform` (NOT merged)

The latest work — the Tinkercad-style transform gizmo (move/rotate/scale + inline editable
dimensions + `✋ Grab` live drag) — is on branch **`m-transform`**, pushed but **not merged**
to `main`. It is code-complete (68 tests pass) but its drag interaction needs a **hands-on
mouse check** before merging (automated clicks can't drive R3F's 3D handles).

To continue it: `git checkout m-transform` and **read that branch's CLAUDE.md** (it has the
full resume + verification steps) and `docs/superpowers/plans/M-Transform-verification-notes.md`.
Quick check: `npm run dev` → place a Block → click it → drag the colored gizmo handles; try the
dimension labels; toggle ✋ Grab + Run and drag a piece. If it feels right, merge to `main`.

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
- **M-Transform (direct manipulation) — NEXT, NOT STARTED.** Tinkercad-style move/rotate/scale
  gizmo, inline editable dimensions, live-intervene grab; auto-pause-on-grab. Spec written
  (`docs/superpowers/specs/2026-06-18-neocad-builder-ux-design.md`), needs its own plan.
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
  `HeldPiece.tsx` (ghost placement), `geometry.ts`, `snap.ts`.
- `src/ui/` — `App.tsx` shell, `Toolbar`, `Palette`, `Properties`, `StatusBar`, `storeContext`.
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
- `npm test` — Vitest (23 tests; includes deterministic physics scenarios).
- `npm run build` — production build → `dist/`.
- Deploy: push to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages).
  Enable Pages → "GitHub Actions" in repo settings once.

## Workflow note

This project is being built with the superpowers skills: brainstorm → write spec →
write plan → execute plan (TDD, frequent commits) → verify in a real browser before
claiming done. Continue M2 by invoking the writing-plans skill against the Stage 1 spec.
