# NeoCad M1 — Playful Building Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working slice of NeoCad's Stage 1 sandbox — place real-world stock from a palette into a live rigid-body world, with held-piece placement, play/pause/reset, basic materials, and autosave.

**Architecture:** A static React + Three.js app where a plain-JSON **design document** (Definition + State) is the single source of truth. A bespoke **physics integration layer** compiles the document into a Jolt world (via `JoltPhysics.js`), steps it at a fixed timestep, and writes transforms back into the document's State, which Three.js renders. Physics is always on; the piece being placed is inert until released.

**Tech Stack:** Vite, React, TypeScript, Three.js, `@react-three/fiber` + `@react-three/drei`, `jolt-physics` (`JoltPhysics.js`), Zustand (document store), Vitest + Testing Library, deployed to GitHub Pages.

**Reference spec:** `docs/superpowers/specs/2026-06-17-neocad-stage1-design.md`

---

## File Structure

```
src/
  document/
    types.ts            # Document, Piece, Fastener, Material, Ground types (Definition + State)
    catalog.ts          # STOCK + FASTENER catalog → primitive/constraint mapping
    document.ts         # create/edit/add-piece operations (pure, immutable)
    serialize.ts        # toJSON / fromJSON (.neocad.json) + version migration
    store.ts            # Zustand store wrapping the document + undo/redo + actions
  physics/
    jolt.ts             # Jolt module init (WASM load), singleton
    integration.ts      # compile document → Jolt world; step (fixed dt); sync State back
    shapes.ts           # primitive (box/cylinder/sphere) → Jolt shape factory
  render/
    Scene.tsx           # R3F canvas: ground, lights, shadows, camera/orbit
    PieceMesh.tsx       # render one piece from State.transform
    HeldPiece.tsx       # ghost piece following cursor until commit
  ui/
    App.tsx             # shell layout (toolbar / palette / viewport / properties / status)
    Toolbar.tsx         # Running/Pause/Reset, Undo/Redo, Save/Open
    Palette.tsx         # Stock tool buttons
    Properties.tsx      # selected-piece properties (size, material, anchored)
    StatusBar.tsx       # counts, pause state, fps
  persistence/
    autosave.ts         # IndexedDB load/save of current document
  main.tsx              # React entry
tests/
  document/*.test.ts
  physics/*.test.ts
  ui/*.test.tsx
```

---

## Task 1: Project scaffold + CI-able test runner

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`
- Create: `.github/workflows/deploy.yml` (GitHub Pages)

- [ ] **Step 1: Scaffold Vite React+TS project**

Run:
```bash
npm create vite@latest . -- --template react-ts
npm install three @react-three/fiber @react-three/drei zustand jolt-physics
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/three
```

- [ ] **Step 2: Configure Vitest** — `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup.ts'] },
})
```
Create `tests/setup.ts` with `import '@testing-library/jest-dom'`.

- [ ] **Step 3: Set Vite base for GitHub Pages** — in `vite.config.ts` add `base: '/neocad/'`.

- [ ] **Step 4: Add a trivial smoke test** — `tests/smoke.test.ts`

```ts
import { it, expect } from 'vitest'
it('runs', () => { expect(1 + 1).toBe(2) })
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run`
Expected: 1 passed.

- [ ] **Step 6: Add GitHub Pages deploy workflow** — `.github/workflows/deploy.yml` builds with `npm run build` and publishes `dist/` on push to `main`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite React+TS app with Vitest and Pages deploy"
```

---

## Task 2: Document types

**Files:**
- Create: `src/document/types.ts`
- Test: `tests/document/types.test.ts`

- [ ] **Step 1: Write the failing test** — assert a hand-built document object satisfies the types and default-construction helper.

```ts
import { it, expect } from 'vitest'
import { emptyDocument, CURRENT_VERSION } from '../../src/document/types'

it('emptyDocument has version, empty pieces, default ground+materials', () => {
  const d = emptyDocument()
  expect(d.version).toBe(CURRENT_VERSION)
  expect(d.pieces).toEqual([])
  expect(d.materials.length).toBeGreaterThan(0)
  expect(d.ground.gravity).toEqual([0, -9.81, 0])
})
```

- [ ] **Step 2: Run, verify fails** (`emptyDocument` not defined).

- [ ] **Step 3: Implement `types.ts`** with:

```ts
export const CURRENT_VERSION = 1
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export interface Transform { position: Vec3; rotation: Quat }
export interface Material {
  name: string; density: number; friction: number; restitution: number; color: string
  // reserved for future FEA evaluator, unused in M1:
  youngsModulus?: number; yieldStrength?: number; poissonRatio?: number
}
export type StockType = 'rod' | 'tube' | 'dowel' | 'slat' | 'joist' | 'panel' | 'block' | 'ball'
export interface Piece {
  id: string; name: string; stockType: StockType
  dimensions: Record<string, number>      // shape-specific
  material: string                         // ref into materials table
  definition: { transform: Transform }
  state: { transform: Transform }
  anchored: boolean
}
export interface Ground { gravity: Vec3 }
export interface Document {
  version: number; metadata: { name: string }
  materials: Material[]; pieces: Piece[]
  ground: Ground; camera?: unknown
}
export const DEFAULT_MATERIALS: Material[] = [
  { name: 'steel', density: 7850, friction: 0.4, restitution: 0.1, color: '#8a8f98' },
  { name: 'aluminum', density: 2700, friction: 0.4, restitution: 0.1, color: '#c9cdd3' },
  { name: 'wood', density: 500, friction: 0.5, restitution: 0.2, color: '#b3854a' },
  { name: 'plastic', density: 1200, friction: 0.3, restitution: 0.3, color: '#3b82c4' },
  { name: 'rubber', density: 1100, friction: 0.9, restitution: 0.8, color: '#2b2b2b' },
]
export function emptyDocument(): Document {
  return {
    version: CURRENT_VERSION, metadata: { name: 'Untitled' },
    materials: structuredClone(DEFAULT_MATERIALS), pieces: [],
    ground: { gravity: [0, -9.81, 0] },
  }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: document types and empty-document factory"`

---

## Task 3: Catalog (stock → primitive)

**Files:**
- Create: `src/document/catalog.ts`
- Test: `tests/document/catalog.test.ts`

M1 only needs the **stock → primitive** half (fasteners arrive in M2/M3). Each stock entry knows its primitive shape, default dimensions, and how to derive a Jolt half-extent/radius.

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from 'vitest'
import { STOCK, makePiece } from '../../src/document/catalog'

it('every stock entry maps to a valid primitive', () => {
  for (const s of Object.values(STOCK))
    expect(['box', 'cylinder', 'sphere']).toContain(s.primitive)
})
it('makePiece(joist) produces a box piece with default dims and wood material', () => {
  const p = makePiece('joist', [0, 1, 0])
  expect(p.stockType).toBe('joist')
  expect(p.material).toBe('wood')
  expect(p.dimensions).toHaveProperty('x')
  expect(p.state.transform.position).toEqual([0, 1, 0])
})
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement `catalog.ts`** — a `STOCK` record mapping each `StockType` to `{ label, primitive, defaultDimensions, defaultMaterial }`, plus `makePiece(stockType, position)` that returns a `Piece` (uses a simple incrementing id helper; `definition.transform` === `state.transform` at creation). Example entries:

```ts
export const STOCK = {
  rod:   { label: 'Rod',   primitive: 'cylinder', defaultDimensions: { radius: 0.05, height: 1.0 }, defaultMaterial: 'steel' },
  joist: { label: 'Joist', primitive: 'box',      defaultDimensions: { x: 0.09, y: 0.04, z: 1.2 },  defaultMaterial: 'wood'  },
  panel: { label: 'Panel', primitive: 'box',      defaultDimensions: { x: 1.2, y: 0.02, z: 0.6 },   defaultMaterial: 'wood'  },
  block: { label: 'Block', primitive: 'box',      defaultDimensions: { x: 0.3, y: 0.3, z: 0.3 },     defaultMaterial: 'wood'  },
  ball:  { label: 'Ball',  primitive: 'sphere',   defaultDimensions: { radius: 0.15 },                defaultMaterial: 'rubber'},
  // ...tube, dowel, slat
} as const
```

> **All 8 stock types are required** (per spec §6b): `rod`, `tube`, `dowel`, `slat`, `joist`, `panel`, `block`, `ball`. The example above spells out 5; the implementer MUST also add `tube` (cylinder, hollow look — collision approximated as solid cylinder in M1), `dowel` (cylinder, thin), and `slat` (box, thin plank). The `StockType` union in Task 2 enumerates all 8, so a missing entry is a type error.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: stock catalog and makePiece factory"`

---

## Task 4: Serialize / deserialize round-trip

**Files:**
- Create: `src/document/serialize.ts`
- Test: `tests/document/serialize.test.ts`

- [ ] **Step 1: Failing test** — round-trip equality + version migration stub.

```ts
import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { toJSON, fromJSON } from '../../src/document/serialize'

it('round-trips a document with a piece', () => {
  const d = emptyDocument(); d.pieces.push(makePiece('block', [0, 2, 0]))
  expect(fromJSON(toJSON(d))).toEqual(d)
})
it('migrates a versionless document to CURRENT_VERSION', () => {
  const legacy = JSON.stringify({ pieces: [], materials: [], ground: { gravity: [0,-9.81,0] }, metadata:{name:'x'} })
  expect(fromJSON(legacy).version).toBe(1)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `toJSON(doc)` = `JSON.stringify`; `fromJSON(str)` parses, runs `migrate()` (fills missing `version`, applies any future step-up migrations), returns `Document`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: document serialize/deserialize with version migration"`

---

## Task 5: Document store (Zustand) + add-piece + undo/redo

**Files:**
- Create: `src/document/document.ts` (pure operations), `src/document/store.ts`
- Test: `tests/document/store.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('addPiece appends and undo removes it', () => {
  const s = createDocStore()
  s.getState().addPiece(makePiece('block', [0, 1, 0]))
  expect(s.getState().doc.pieces).toHaveLength(1)
  s.getState().undo()
  expect(s.getState().doc.pieces).toHaveLength(0)
  s.getState().redo()
  expect(s.getState().doc.pieces).toHaveLength(1)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — Zustand store holding `{ doc, past[], future[] }`; actions `addPiece`, `updatePiece`, `removePiece`, `undo`, `redo`, `loadDoc`. Structural mutations push the prior `doc` onto `past` (deep clone) and clear `future`. **Undo/redo operate on Definition only**, never on per-frame State writes (see Task 7 note).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: document store with undo/redo"`

---

## Task 6: Jolt init + primitive shape factory

**Files:**
- Create: `src/physics/jolt.ts`, `src/physics/shapes.ts`
- Test: `tests/physics/shapes.test.ts`

- [ ] **Step 1: Failing test** — load Jolt and build each primitive shape without throwing.

```ts
import { it, expect, beforeAll } from 'vitest'
import { initJolt } from '../../src/physics/jolt'
import { makeShape } from '../../src/physics/shapes'

let Jolt: any
beforeAll(async () => { Jolt = await initJolt() })

it('builds box, cylinder, sphere shapes', () => {
  expect(makeShape(Jolt, 'box', { x: 0.2, y: 0.2, z: 0.2 })).toBeTruthy()
  expect(makeShape(Jolt, 'cylinder', { radius: 0.1, height: 1 })).toBeTruthy()
  expect(makeShape(Jolt, 'sphere', { radius: 0.15 })).toBeTruthy()
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `initJolt()` dynamically imports `jolt-physics` (`await import('jolt-physics')`, then `await JoltInit()`), memoized. `makeShape` maps primitive+dimensions to `BoxShape` (half-extents), `CylinderShape`, `SphereShape`. *Note: dimensions are full extents in the document; halve for box half-extents.*
- [ ] **Step 4: Run, verify pass** (`npx vitest run tests/physics/shapes.test.ts`).
- [ ] **Step 5: Commit** — `git commit -m "feat: Jolt init and primitive shape factory"`

---

## Task 7: Physics integration layer — compile, fixed-step, sync (the risky core)

**Files:**
- Create: `src/physics/integration.ts`
- Test: `tests/physics/integration.test.ts`

This is the highest-risk module; the test below is the M1 determinism + behavior anchor.

- [ ] **Step 1: Failing scenario test** — a dropped block falls and comes to rest on the ground.

```ts
import { it, expect, beforeAll } from 'vitest'
import { initJolt } from '../../src/physics/jolt'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { PhysicsWorld } from '../../src/physics/integration'

let Jolt: any
beforeAll(async () => { Jolt = await initJolt() })

it('a dropped block lands and rests on the ground (deterministic, fixed dt)', () => {
  const doc = emptyDocument()
  const block = makePiece('block', [0, 3, 0])   // 0.3 cube, dropped from y=3
  doc.pieces.push(block)
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 180; i++) world.step(1 / 60)  // 3 seconds, fixed dt
  world.syncToDocument(doc)
  const y = doc.pieces[0].state.transform.position[1]
  expect(y).toBeGreaterThan(0.14)   // ~half-extent above ground
  expect(y).toBeLessThan(0.16)
})

it('an anchored piece does not move', () => {
  const doc = emptyDocument()
  const b = makePiece('block', [0, 3, 0]); b.anchored = true
  doc.pieces.push(b)
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 60; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  expect(doc.pieces[0].state.transform.position[1]).toBeCloseTo(3, 5)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement `PhysicsWorld`:**
  - Constructor: create `JoltSettings`/`PhysicsSystem`, a static ground plane at y=0, set gravity from `doc.ground.gravity`. For each piece, build a body via `makeShape`; `anchored` → `EMotionType_Static`, else `EMotionType_Dynamic` with mass derived from material `density × volume`; set initial position/rotation from `state.transform`. Keep a `Map<pieceId, bodyId>`.
  - **Jolt setup detail:** `PhysicsSystem.Update(dt, collisionSteps, tempAllocator, jobSystem)` requires a `JPH::TempAllocatorImpl` and a `JobSystemThreadPool` (or single-threaded job system) created at init. Create these in `initJolt()`/the `PhysicsWorld` constructor and hold references; pass them on every `Update`.
  - `step(dt)`: call `physicsSystem.Update(dt, 1, tempAllocator, jobSystem)` with a **fixed** `dt` (always pass `1/60`; the test relies on this — see spec §12 determinism note).
  - `syncToDocument(doc)`: for each piece, read body transform, write into `piece.state.transform`. **Definition is untouched.**
  - `dispose()`: free Jolt bodies/system (Jolt requires explicit `destroy()`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: physics integration layer with deterministic step and state sync"`

> **Undo/redo note for executors:** the render loop calls `syncToDocument` every frame, mutating State. Do NOT route those writes through the undo stack (Task 5) — only structural Definition edits are undoable. Keep State sync as a direct mutation outside the history mechanism.

---

## Task 8: Render the scene from State

**Files:**
- Create: `src/render/Scene.tsx`, `src/render/PieceMesh.tsx`
- Test: `tests/ui/scene.test.tsx` (smoke: renders without throwing, one mesh per piece)

- [ ] **Step 1: Failing test** — render `<Scene>` with a 2-piece document, assert 2 `PieceMesh` nodes (use a test id on each mesh group).
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `Scene.tsx`: `<Canvas shadows>` with `<OrbitControls>`, a directional light + ambient, a ground `<Grid>`/plane receiving shadows, and `doc.pieces.map(p => <PieceMesh piece={p} />)`. `PieceMesh.tsx`: switch on `stockType`'s primitive → `boxGeometry|cylinderGeometry|sphereGeometry` sized from `dimensions`, positioned/rotated from `state.transform`, colored from its material. Drive the physics loop with `useFrame((_, dt) => { world.step(1/60); world.syncToDocument(doc); })` (fixed dt, ignore real dt for determinism).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: render pieces from document state"`

---

## Task 9: App shell — toolbar, palette, status bar

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/Toolbar.tsx`, `src/ui/Palette.tsx`, `src/ui/StatusBar.tsx`
- Test: `tests/ui/shell.test.tsx`

- [ ] **Step 1: Failing test** — `App` renders a Run/Pause control, stock buttons for each `STOCK` entry, and a status bar showing `parts: 0`.
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — flatbox layout (CSS grid): top `Toolbar` (▶/⏸ toggle bound to a `running` store flag, ↺ Reset, Undo/Redo, Save/Open stubs wired in Task 11), left `Palette` (button per `STOCK` entry that sets `activeTool`), center `Scene`, right `Properties` (stub for M1: shows selection or "nothing selected"), bottom `StatusBar` (reads `doc.pieces.length`, `running`, fps).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: app shell with toolbar, palette, status bar"`

---

## Task 10: Held-piece placement (inert until release)

**Files:**
- Create: `src/render/HeldPiece.tsx`
- Modify: `src/render/Scene.tsx`, `src/document/store.ts` (add `activeTool`, `placeHeld`)
- Test: `tests/ui/placement.test.ts` (logic-level, not full 3D)

The held piece is **not** added to the physics world; it's a preview. On commit, `addPiece` adds it to the document (Definition) and the next physics rebuild includes it as a dynamic body.

- [ ] **Step 1: Failing test** — store logic: selecting a tool sets `activeTool`; `commitHeldAt(pos)` adds a piece of that stock at `pos` and clears `activeTool`.

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'

it('commitHeldAt adds the active-tool stock as a piece and clears the tool', () => {
  const s = createDocStore()
  s.getState().setActiveTool('block')
  s.getState().commitHeldAt([1, 0.5, 0])
  expect(s.getState().doc.pieces).toHaveLength(1)
  expect(s.getState().doc.pieces[0].stockType).toBe('block')
  expect(s.getState().activeTool).toBeNull()
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — store gains `activeTool`, `setActiveTool`, `commitHeldAt`. `HeldPiece.tsx`: when `activeTool` set, render a semi-transparent preview mesh that follows a raycast onto the ground plane (drei `<Plane>` + pointer events); snap position to a configurable grid (default 0.1m; store `snap` flag, default on — addresses spec §12 snapping). On pointer-down, call `commitHeldAt(snappedPos)`. The new piece enters the live world via Task 7 rebuild and falls/settles.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: held-piece placement, inert until release"`

> **Rebuild note:** when `doc.pieces` changes structurally, recreate the `PhysicsWorld` (simplest correct approach for M1) OR add an `addBody` incremental path. For M1, full rebuild on structural change is acceptable; note it as a perf TODO for later milestones.

---

## Task 11: Play / pause / reset + IndexedDB autosave + Save/Open

**Files:**
- Create: `src/persistence/autosave.ts`
- Modify: `src/document/store.ts`, `src/ui/Toolbar.tsx`
- Test: `tests/persistence/autosave.test.ts`

- [ ] **Step 1: Failing test** — autosave round-trips through a fake IndexedDB (use `fake-indexeddb`); `saveDoc(doc)` then `loadDoc()` returns an equal document.

```bash
npm install -D fake-indexeddb
```
```ts
import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { saveDoc, loadDoc } from '../../src/persistence/autosave'

it('autosave persists and restores the document', async () => {
  const d = emptyDocument(); d.metadata.name = 'Bridge'
  await saveDoc(d)
  expect((await loadDoc())?.metadata.name).toBe('Bridge')
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** —
  - `autosave.ts`: open an IndexedDB store `neocad`, key `current`; `saveDoc`/`loadDoc` using `toJSON`/`fromJSON`. Debounce autosave on document change (subscribe to store).
  - **Pause/Reset semantics:** `running` flag gates whether `useFrame` calls `world.step`. Pause stops stepping (State frozen). Reset rebuilds the world from each piece's `definition.transform`, resetting State to Definition.
  - **Save/Open:** Save = download `toJSON(doc)` as `<name>.neocad.json` (Blob + anchor). Open = file input → `fromJSON` → `loadDoc` into store.
  - On launch, attempt `loadDoc()` from IndexedDB to restore the working document (document-lifecycle, spec §12: restore-on-launch).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: play/pause/reset, IndexedDB autosave, file save/open"`

---

## Task 12: M1 manual verification (the wow demo)

**Files:** none (verification only)

- [ ] **Step 1:** `npm run dev`, open the app.
- [ ] **Step 2:** Place several **Block** and **Joist** pieces; confirm each is inert while held, snaps to grid, and falls/settles on release (live collision + gravity + stacking).
- [ ] **Step 3:** Stack pieces into a small tower; confirm it stacks believably and a poorly balanced stack topples.
- [ ] **Step 4:** ⏸ Pause — confirm motion freezes; ▶ resume — confirm it continues; ↺ Reset — confirm pieces return to placed positions.
- [ ] **Step 5:** Refresh the page — confirm the document is restored from autosave. Save to file, reload, Open the file — confirm it round-trips.
- [ ] **Step 6:** Per the project's "verify before reporting fixed" rule, only mark M1 done after observing all of the above in the running app. Commit a short `docs/superpowers/plans/M1-verification-notes.md` recording what was observed.

---

## Out of scope for M1 (next plans)
- **M2:** anchoring UX, rigid fasteners (weld/glue/bolt/nail), stable-structure demo, glTF/STL export, materials editor UI, properties-panel editing.
- **M3:** hinge/slider/ball/rope fasteners, motors (axle/wheel), pulley + driven-cart demos, incremental physics-world updates.
