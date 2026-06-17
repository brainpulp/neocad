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
- **M2 (stable structures) — NOT STARTED.** Anchoring UX, rigid fasteners
  (weld/glue/bolt/nail), stable-structure demo, glTF/STL export, materials editor,
  properties-panel editing. Needs its own plan via the writing-plans skill.
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
- `src/persistence/` — `autosave.ts` (IndexedDB), `file.ts` (download/open `.neocad.json`).

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
