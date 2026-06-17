# NeoCad M2 — Stable Structures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users build structures that hold — connect pieces with rigid real-world fasteners (weld/glue/bolt/nail), anchor pieces to the world, edit piece/material properties, and export the result to glTF/STL.

**Architecture:** Extends M1's document model with first-class **fasteners** (a fastener relates two pieces and compiles to a Jolt constraint), a **selection** model for editing, and **exporters** that build a throwaway Three.js scene from current State. Same source-of-truth principle: fasteners live in the Definition; physics compiles them into Jolt `FixedConstraint`s.

**Tech Stack:** Same as M1 (Vite + React + TS + Three.js/R3F + Jolt + Zustand + Vitest). Adds Three's `GLTFExporter` and `STLExporter` from `three/examples/jsm/exporters`.

**Reference spec:** `docs/superpowers/specs/2026-06-17-neocad-stage1-design.md` (§6 domain model, §10 milestones M2).

---

## Design decisions locked for M2 (review these)

1. **Rigid fasteners only.** `weld | glue | bolt | nail` — all compile to a Jolt **FixedConstraint** and behave identically in v1. They ship as distinct named entries (icon/label) because their strengths will diverge once the failure/FEA evaluator arrives (spec §6b). Articulated fasteners (hinge/slider/ball/rope) and motors are **M3**, not here.
2. **Selection = single-select, transient.** Click a piece to select it (highlights); click empty space clears. Selection is UI state — not saved, not undoable. The Properties panel edits the selected piece.
3. **Fastening interaction.** Selecting a fastener tool from the palette enters "fasten mode". Click piece A (marks it pending), then click piece B → a fastener is created. The tool stays active for rapid chaining; pending-A clears after each fastener. Esc or re-clicking the tool exits fasten mode.
4. **Pointer priority in the viewport:** stock placement (`activeTool`) > fastening (`fastenTool`) > selection.
5. **Property edits commit on blur/Enter** (not per keystroke) to avoid flooding undo history.
6. **glTF/STL are one-way exports** of current posed geometry (spec §8). `.neocad.json` remains canonical.

---

## File Structure (new/changed)

```
src/document/
  types.ts        # + Fastener, FastenerType; Document.fasteners
  catalog.ts      # + FASTENERS catalog (rigid → 'fixed')
  document.ts     # + addFastener/removeFastener/updateMaterial/addMaterial ops
  store.ts        # + fasteners actions, selection (selectedId), fasten mode (fastenTool, pendingFastenA)
  serialize.ts    # migration: ensure fasteners[] exists
src/physics/
  integration.ts  # + compile fasteners → Jolt FixedConstraint
src/render/
  Scene.tsx       # selection click, fasten click, fastener markers
  FastenerMarker.tsx  # small indicator at fastener midpoint
src/ui/
  Palette.tsx     # + Fasteners group
  Properties.tsx  # editable: name, dimensions, material, anchored; + selection-aware
  MaterialsEditor.tsx # edit/add materials
  Toolbar.tsx     # + Export glTF / Export STL
src/export/
  scene.ts        # build a THREE.Group from the document (pure-ish, testable)
  exporters.ts    # glTF/STL → Blob + download
tests/...
```

---

## Task 1: Fastener type + document ops + migration

**Files:**
- Modify: `src/document/types.ts`, `src/document/document.ts`, `src/document/serialize.ts`
- Test: `tests/document/fasteners.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from 'vitest'
import { emptyDocument, CURRENT_VERSION } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { addFastener, removeFastener } from '../../src/document/document'
import { fromJSON } from '../../src/document/serialize'

it('emptyDocument has an empty fasteners array', () => {
  expect(emptyDocument().fasteners).toEqual([])
})

it('addFastener links two pieces; removeFastener removes it', () => {
  const a = makePiece('joist', [0, 1, 0]); const b = makePiece('joist', [0, 2, 0])
  let doc = emptyDocument(); doc.pieces.push(a, b)
  doc = addFastener(doc, { id: 'f1', type: 'weld', partA: a.id, partB: b.id })
  expect(doc.fasteners).toHaveLength(1)
  doc = removeFastener(doc, 'f1')
  expect(doc.fasteners).toHaveLength(0)
})

it('migrates a fastener-less document by adding fasteners[]', () => {
  const legacy = JSON.stringify({ version: 1, metadata: { name: 'x' }, materials: [], pieces: [], ground: { gravity: [0,-9.81,0] } })
  expect(fromJSON(legacy).fasteners).toEqual([])
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement.**
  - `types.ts`: add
    ```ts
    export type FastenerType = 'weld' | 'glue' | 'bolt' | 'nail'
    export interface Fastener { id: string; type: FastenerType; partA: string; partB: string }
    ```
    Add `fasteners: Fastener[]` to `Document`; add `fasteners: []` to `emptyDocument()`.
  - `document.ts`: add `addFastener(doc, f)`, `removeFastener(doc, id)` (immutable, mirror piece ops). Also `removePiece` must drop fasteners referencing that piece — update it to filter `fasteners` too.
  - `serialize.ts`: in `migrate`, `if (!doc.fasteners) doc.fasteners = []`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: fastener type, document ops, and migration"`

---

## Task 2: Fastener catalog

**Files:**
- Modify: `src/document/catalog.ts`
- Test: `tests/document/fastener-catalog.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from 'vitest'
import { FASTENERS } from '../../src/document/catalog'
import type { FastenerType } from '../../src/document/types'

const RIGID: FastenerType[] = ['weld', 'glue', 'bolt', 'nail']
it('all rigid fasteners are present and map to the fixed constraint', () => {
  for (const t of RIGID) {
    expect(FASTENERS[t]).toBeDefined()
    expect(FASTENERS[t].constraint).toBe('fixed')
  }
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — in `catalog.ts`:
  ```ts
  export type ConstraintKind = 'fixed' // M3 adds: revolute | prismatic | ball | rope
  export interface FastenerDef { label: string; constraint: ConstraintKind }
  export const FASTENERS: Record<FastenerType, FastenerDef> = {
    weld: { label: 'Weld', constraint: 'fixed' },
    glue: { label: 'Glue', constraint: 'fixed' },
    bolt: { label: 'Bolt', constraint: 'fixed' },
    nail: { label: 'Nail', constraint: 'fixed' },
  }
  ```
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: rigid fastener catalog"`

---

## Task 3: Physics — compile fasteners to fixed constraints

**Files:**
- Modify: `src/physics/integration.ts`
- Test: `tests/physics/fasteners.test.ts`

- [ ] **Step 1: Probe the Jolt FixedConstraint API** (like M1's prototyping). Run a Node snippet to confirm constructor names before coding:
  ```bash
  node --input-type=module -e "import m from 'jolt-physics'; const J=await m(); console.log('FixedConstraintSettings', typeof J.FixedConstraintSettings, 'AddConstraint', typeof J.JoltInterface);"
  ```
  Expected: `FixedConstraintSettings` is a function. The pattern is: `const s = new Jolt.FixedConstraintSettings(); s.mAutoDetectPoint = true; const c = s.Create(bodyA, bodyB); physicsSystem.AddConstraint(c);` — verify `mAutoDetectPoint` and `Create(bodyA, bodyB)` exist; adjust if the probe shows otherwise. Note: you need the actual **Body** objects (not just IDs) — keep a `Map<pieceId, Body>` in addition to the IDs map, or fetch via `bodyInterface`/`bodyLockInterface`. Simplest: store the `Body` returned by `CreateBody` in the constructor.

- [ ] **Step 2: Failing test** — a fixed fastener keeps two stacked pieces rigidly together; lifting (anchoring) the top keeps the bottom attached instead of falling.

```ts
import { it, expect, beforeAll } from 'vitest'
import { initJolt, type JoltModule } from '../../src/physics/jolt'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { PhysicsWorld } from '../../src/physics/integration'

let Jolt: JoltModule
beforeAll(async () => { Jolt = await initJolt() })

it('a weld holds a hanging piece up when its partner is anchored', () => {
  const doc = emptyDocument()
  const top = makePiece('block', [0, 3, 0]); top.anchored = true
  const bottom = makePiece('block', [0, 2.6, 0]) // just below, within weld reach
  doc.pieces.push(top, bottom)
  doc.fasteners.push({ id: 'f1', type: 'weld', partA: top.id, partB: bottom.id })
  const world = new PhysicsWorld(Jolt, doc)
  for (let i = 0; i < 120; i++) world.step(1 / 60)
  world.syncToDocument(doc)
  // Without the weld, bottom would fall to ~0.13; welded to an anchored top it stays high.
  expect(doc.pieces[1].state.transform.position[1]).toBeGreaterThan(2.0)
  world.dispose()
})
```

- [ ] **Step 3: Run, verify fails.**
- [ ] **Step 4: Implement** — in `PhysicsWorld`:
  - Store created bodies: `private bodyObjs = new Map<string, any>()`; in `createPieceBody`, after `CreateBody`, `this.bodyObjs.set(piece.id, body)`.
  - After all bodies are created in the constructor, iterate `doc.fasteners`: look up both bodies; for `constraint === 'fixed'`, build a `FixedConstraintSettings` (auto-detect anchor points), `Create(bodyA, bodyB)`, and `physicsSystem.AddConstraint(...)`. Skip fasteners whose pieces are missing.
  - Constraints are torn down with the world on `dispose()`/rebuild (full rebuild already happens on structural change — extend `structureKey` to include fasteners so adding a fastener rebuilds: see Task 7).
- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Commit** — `git commit -m "feat: compile rigid fasteners to Jolt fixed constraints"`

---

## Task 4: Selection model + click-to-select

**Files:**
- Modify: `src/document/store.ts`, `src/render/Scene.tsx`, `src/render/PieceMesh.tsx`
- Test: `tests/ui/selection.test.ts`

- [ ] **Step 1: Failing test** (store logic)

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('select sets selectedId; clearing sets it null; removing a selected piece clears it', () => {
  const s = createDocStore()
  const p = makePiece('block', [0, 1, 0]); s.getState().addPiece(p)
  s.getState().select(p.id)
  expect(s.getState().selectedId).toBe(p.id)
  s.getState().removePiece(p.id)
  expect(s.getState().selectedId).toBeNull()
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — store: add `selectedId: string | null` (default null), `select(id)`, and make `removePiece` clear `selectedId` if it matches. In `Scene`/`PieceMesh`: add `onPointerDown` to each mesh that (only when no `activeTool` and no `fastenTool`) calls `select(piece.id)` and `e.stopPropagation()`. Add a background click on the ground catcher to clear selection. Visually highlight the selected mesh (e.g. emissive or an outline color) — pass `selected` prop to `PieceMesh`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: piece selection model and click-to-select"`

---

## Task 5: Properties panel editing

**Files:**
- Modify: `src/ui/Properties.tsx`
- Test: `tests/ui/properties.test.tsx`

- [ ] **Step 1: Failing test** — with a selected piece, the panel shows its name and an Anchored checkbox; toggling the checkbox updates the piece.

```tsx
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../../src/render/Scene', () => ({ Scene: () => <div /> }))
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { Properties } from '../../src/ui/Properties'

it('toggling Anchored updates the selected piece', () => {
  const store = createDocStore()
  const p = makePiece('block', [0, 1, 0]); store.getState().addPiece(p); store.getState().select(p.id)
  render(<StoreContext.Provider value={store}><Properties /></StoreContext.Provider>)
  const cb = screen.getByLabelText(/Anchored/i) as HTMLInputElement
  expect(cb.checked).toBe(false)
  fireEvent.click(cb)
  expect(store.getState().doc.pieces[0].anchored).toBe(true)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `Properties.tsx`: when a piece is selected, render editable controls bound to the selected piece:
  - Name (text, commit on blur), Material (`<select>` of `doc.materials`), Anchored (checkbox), dimension number inputs derived from the piece's `dimensions` keys (commit on blur/Enter). Each commit calls `updatePiece(id, patch)`. When nothing is selected, keep the existing stub text.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: editable properties panel for selected piece"`

---

## Task 6: Materials editor

**Files:**
- Modify: `src/document/document.ts`, `src/document/store.ts`, create `src/ui/MaterialsEditor.tsx`
- Test: `tests/document/materials.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'

it('addMaterial appends; updateMaterial edits by name', () => {
  const s = createDocStore()
  s.getState().addMaterial({ name: 'titanium', density: 4500, friction: 0.4, restitution: 0.1, color: '#9aa' })
  expect(s.getState().doc.materials.some(m => m.name === 'titanium')).toBe(true)
  s.getState().updateMaterial('titanium', { density: 4506 })
  expect(s.getState().doc.materials.find(m => m.name === 'titanium')!.density).toBe(4506)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `document.ts`: `addMaterial(doc, m)`, `updateMaterial(doc, name, patch)` (immutable). store: wire both via `commit`. `MaterialsEditor.tsx`: list materials with editable density/friction/color (commit on blur) and an "+ new material" row. Mount it in the right panel under Properties.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: materials editor (add/edit materials)"`

---

## Task 7: Fastening interaction + Fasteners palette group

**Files:**
- Modify: `src/document/store.ts`, `src/ui/Palette.tsx`, `src/render/Scene.tsx`
- Test: `tests/ui/fastening.test.ts`

- [ ] **Step 1: Failing test** (store logic)

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('two fasten clicks create a fastener and clear pending-A', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0,1,0]); const b = makePiece('joist', [0,2,0])
  s.getState().addPiece(a); s.getState().addPiece(b)
  s.getState().setFastenTool('bolt')
  s.getState().fastenClick(a.id)
  expect(s.getState().pendingFastenA).toBe(a.id)
  s.getState().fastenClick(b.id)
  expect(s.getState().doc.fasteners).toHaveLength(1)
  expect(s.getState().doc.fasteners[0].type).toBe('bolt')
  expect(s.getState().pendingFastenA).toBeNull()
})

it('fastenClick on the same piece twice is ignored', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0,1,0]); s.getState().addPiece(a)
  s.getState().setFastenTool('weld')
  s.getState().fastenClick(a.id); s.getState().fastenClick(a.id)
  expect(s.getState().doc.fasteners).toHaveLength(0)
  expect(s.getState().pendingFastenA).toBe(a.id)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — store: add `fastenTool: FastenerType | null`, `setFastenTool`, `pendingFastenA: string | null`, and `fastenClick(pieceId)`:
  - if no `fastenTool`, ignore;
  - if `pendingFastenA` null → set it;
  - else if `pieceId === pendingFastenA` → ignore;
  - else create a fastener `{ id: nextFastenerId(), type: fastenTool, partA: pendingFastenA, partB: pieceId }` via `addFastener`, then clear `pendingFastenA`.
  - Add a `nextFastenerId()` helper (mirror catalog's id counter) in store or catalog.
  - Selecting a stock tool clears `fastenTool` and vice-versa (mutually exclusive modes).
  - Extend the physics `structureKey` (Scene) to include `doc.fasteners.map(f=>f.id)` so adding a fastener rebuilds the world.
  - `Palette.tsx`: add a **FASTENERS** group below STOCK, a button per `FASTENERS` entry that toggles `fastenTool`.
  - `Scene` piece `onPointerDown`: when `fastenTool` is set, route to `fastenClick(piece.id)` instead of `select`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: fastening interaction and fasteners palette"`

---

## Task 8: Fastener visual marker

**Files:**
- Create: `src/render/FastenerMarker.tsx`; Modify: `src/render/Scene.tsx`
- Test: `tests/render/fastener-marker.test.ts` (pure midpoint helper)

- [ ] **Step 1: Failing test** — a pure `fastenerMidpoint(doc, fastener)` returns the average of the two pieces' State positions.

```ts
import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { fastenerMidpoint } from '../../src/render/FastenerMarker'

it('midpoint is the average of the two pieces positions', () => {
  const a = makePiece('block', [0,0,0]); const b = makePiece('block', [2,4,0])
  const doc = emptyDocument(); doc.pieces.push(a,b)
  expect(fastenerMidpoint(doc, { id:'f', type:'weld', partA:a.id, partB:b.id })).toEqual([1,2,0])
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `FastenerMarker.tsx`: export pure `fastenerMidpoint(doc, fastener)` and a component rendering a small marker (e.g. a tiny sphere) at the midpoint, updated each frame like pieces (read State). In `Scene`, map `doc.fasteners` to markers (return null if a referenced piece is missing).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: fastener midpoint markers"`

---

## Task 9: Export glTF + STL

**Files:**
- Create: `src/export/scene.ts`, `src/export/exporters.ts`; Modify: `src/ui/Toolbar.tsx`, `src/ui/App.tsx`
- Test: `tests/export/scene.test.ts`

- [ ] **Step 1: Failing test** — `buildExportScene(doc)` returns a Three.Group with one mesh per piece, positioned from State.

```ts
import { it, expect } from 'vitest'
import { emptyDocument } from '../../src/document/types'
import { makePiece } from '../../src/document/catalog'
import { buildExportScene } from '../../src/export/scene'

it('builds one mesh per piece at its state position', () => {
  const doc = emptyDocument()
  doc.pieces.push(makePiece('block', [1, 0.5, 0]), makePiece('rod', [0, 1, 0]))
  const group = buildExportScene(doc)
  expect(group.children).toHaveLength(2)
  expect(group.children[0].position.toArray()).toEqual([1, 0.5, 0])
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** —
  - `scene.ts`: `buildExportScene(doc)` creates a `THREE.Group`; for each piece, build the geometry via `geometryFor` (reuse from `render/geometry.ts`) → `BufferGeometry` (BoxGeometry/CylinderGeometry/SphereGeometry), a `MeshStandardMaterial` colored from its material, a `Mesh` positioned/quaternioned from State; add to group. Pure Three (no R3F), so it runs in jsdom.
  - `exporters.ts`: `exportGLTF(doc)` uses `GLTFExporter().parse(group, ...)` → Blob (`.glb` or `.gltf`) → download; `exportSTL(doc)` uses `STLExporter().parse(group)` → Blob `.stl` → download. Reuse the download helper pattern from `persistence/file.ts` (extract a shared `downloadBlob(blob, filename)` if convenient).
  - `Toolbar.tsx`: add **Export glTF** and **Export STL** buttons calling handlers passed from `App` (which call the exporters with the current doc).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: glTF and STL export of current state"`

---

## Task 10: M2 manual verification

**Files:** none (verification only) — use the browser preview tools.

- [ ] **Step 1:** `npm run dev`; place 4 **Rod** legs and a **Panel** top to rough out a table.
- [ ] **Step 2:** Select the panel; in Properties confirm you can edit its name/material/dimensions and toggle Anchored; confirm edits apply (and undo works).
- [ ] **Step 3:** Use a **Weld**/**Bolt** to fasten the legs to the top; confirm fasten-mode click A → click B creates a fastener (marker appears) and the assembly now moves as one / holds together.
- [ ] **Step 4:** Build a deliberately unstable structure; confirm it visibly topples when running, and a well-built/anchored one stands.
- [ ] **Step 5:** Add a new material in the Materials editor; assign it to a piece; confirm color/behavior change.
- [ ] **Step 6:** Export glTF and STL; confirm files download and (glTF) opens in an external viewer.
- [ ] **Step 7:** Per the project's "verify before reporting fixed" rule, only mark M2 done after observing all the above in the running app. Append observations to `docs/superpowers/plans/M2-verification-notes.md`.

---

## Out of scope for M2 (→ M3)
- Articulated fasteners (hinge/slider/ball/rope), motors (axle/wheel), pulley/cart demos.
- Incremental physics-world updates (still full rebuild on structural change).
- Distinct fastener strengths / failure (arrives with the FEA evaluator).
