# NeoCad M-Transform — Direct Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tinkercad-style direct manipulation of the selected piece — move/rotate/scale via on-canvas gizmo handles, inline editable dimensions, with auto-pause-on-grab plus an opt-in live-intervene grab.

**Architecture:** Wrap the selected piece in drei `PivotControls`. A pure `transform.ts` maps a decomposed world matrix → a document patch (snapped position, rotation, and per-primitive dimensions from scale). Grabbing a handle pauses physics and suspends per-frame mesh-sync for that piece (so the gizmo owns the mesh); releasing commits to the Definition (one undo entry) and resumes. A separate "✋ Grab" toggle drives a kinematic live-drag while running.

**Tech Stack:** Same as before (Vite + React + TS + Three.js + @react-three/fiber + @react-three/drei `PivotControls` + Jolt + Zustand + Vitest).

**Reference spec:** `docs/superpowers/specs/2026-06-18-neocad-builder-ux-design.md` (M-Transform section).

---

## Key integration facts (verified)

- `PivotControls` props: `onDragStart`, `onDrag(l, deltaL, w, deltaW: Matrix4)`, `onDragEnd`, `anchor`, `scale`, `fixed`, `disableScaling/Rotations/Sliders/Axes`, `autoTransform`, `annotations`, `depthTest`, `matrix`.
- **Conflict to manage:** `Scene.tsx`'s `Sim` writes each piece's mesh transform every frame from `state.transform`. While a gizmo drag is active this would fight the gizmo. Fix: a `transformDraggingId` in the store; `Sim` skips mesh-sync for that id while dragging, so `PivotControls` owns the mesh during the drag.
- **Auto-pause:** `onDragStart` records `wasRunning = running`, sets `running=false` and `transformDraggingId=piece.id`. `onDragEnd` commits, clears the id, and restores `running=wasRunning`.
- Commit goes through `updatePiece` (one undoable entry) and bumps the world rebuild via the existing `structureKey` (which already includes dimensions + transform-independent fields) — note: position/rotation changes also need a rebuild, so the commit sets both `definition.transform` and `state.transform`, and we add transform to `structureKey` (see Task 3).

---

## File Structure

```
src/render/transform.ts         # NEW: pure matrix-decomposition → document patch (snapped pos, rotation, dims)
src/render/TransformGizmo.tsx    # NEW: PivotControls around selected piece; pause/commit/resume
src/render/DimensionLabels.tsx   # NEW: inline editable dimension labels (drei <Html>)
src/document/store.ts            # + transformDraggingId, setTransformDragging; + grabMode (live-intervene)
src/render/Scene.tsx             # mount gizmo + labels for selected piece; skip sync for dragging id; wire live-grab
src/ui/Toolbar.tsx               # + "✋ Grab" toggle
src/render/snap.ts               # reuse snapToGrid
tests/...
```

---

## Task 1: Transform math (pure)

**Files:**
- Create: `src/render/transform.ts`
- Test: `tests/render/transform.test.ts`

`transformPatch(piece, { position, quaternion, scale })` returns a `Partial<Piece>` patch: snapped `definition`/`state` transform and new `dimensions` derived from per-axis scale, clamped to a small minimum. Scale→dimensions mapping per primitive:
- **box:** `x*=sx, y*=sy, z*=sz`
- **cylinder:** `radius *= max(sx, sz)`, `height *= sy`
- **sphere:** `radius *= max(sx, sy, sz)` (uniform)

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { transformPatch, MIN_DIM } from '../../src/render/transform'

it('moves and snaps position into both definition and state', () => {
  const p = makePiece('block', [0, 1, 0])
  const patch = transformPatch(p, { position: [0.13, 1.0, -0.04], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] })
  expect(patch.definition!.transform.position).toEqual([0.1, 1.0, -0.0])
  expect(patch.state!.transform.position).toEqual([0.1, 1.0, -0.0])
})

it('scales a box per-axis into dimensions', () => {
  const p = makePiece('block', [0, 0, 0]) // 0.3 cube
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 1, 0.5] })
  expect(patch.dimensions!.x).toBeCloseTo(0.6)
  expect(patch.dimensions!.y).toBeCloseTo(0.3)
  expect(patch.dimensions!.z).toBeCloseTo(0.15)
})

it('scales a cylinder: radius from max(x,z), height from y', () => {
  const p = makePiece('rod', [0, 0, 0]) // radius 0.05, height 1.0
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [3, 2, 1] })
  expect(patch.dimensions!.radius).toBeCloseTo(0.15) // max(3,1)*0.05
  expect(patch.dimensions!.height).toBeCloseTo(2.0)  // 2*1.0
})

it('clamps dimensions to a positive minimum', () => {
  const p = makePiece('block', [0, 0, 0])
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [0, 0, 0] })
  expect(patch.dimensions!.x).toBe(MIN_DIM)
})

it('passes rotation through to both transforms', () => {
  const p = makePiece('block', [0, 0, 0])
  const q: [number, number, number, number] = [0, 0.7071, 0, 0.7071]
  const patch = transformPatch(p, { position: [0, 0, 0], quaternion: q, scale: [1, 1, 1] })
  expect(patch.definition!.transform.rotation).toEqual(q)
})
```

- [ ] **Step 2: Run, verify fails** — `npx vitest run tests/render/transform.test.ts`.
- [ ] **Step 3: Implement `transform.ts`:**
  - `export const MIN_DIM = 0.005`
  - `transformPatch(piece, { position, quaternion, scale })`:
    - `pos = snapToGrid(position)` (reuse `snap.ts`).
    - `dims = scaleDimensions(piece, scale)` per the mapping above, each `Math.max(MIN_DIM, …)`.
    - return `{ dimensions: dims, definition: { transform: { position: pos, rotation: quaternion } }, state: { transform: { position: pos, rotation: quaternion } } }`.
  - `scaleDimensions` switches on `STOCK[piece.stockType].primitive`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: pure transform math (matrix decomposition → document patch)"`

---

## Task 2: Store — drag state + grab mode

**Files:**
- Modify: `src/document/store.ts`
- Test: `tests/document/transform-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'

it('transformDragging tracks the dragged piece id', () => {
  const s = createDocStore()
  s.getState().setTransformDragging('p_1')
  expect(s.getState().transformDraggingId).toBe('p_1')
  s.getState().setTransformDragging(null)
  expect(s.getState().transformDraggingId).toBeNull()
})

it('grabMode toggles', () => {
  const s = createDocStore()
  expect(s.getState().grabMode).toBe(false)
  s.getState().setGrabMode(true)
  expect(s.getState().grabMode).toBe(true)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — add to `DocState`: `transformDraggingId: string | null`, `setTransformDragging: (id) => void`, `grabMode: boolean`, `setGrabMode: (on) => void`; defaults `null`/`false`; setters are plain `set({...})` (transient UI state, not undoable).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: transform drag + grab-mode store state"`

---

## Task 3: Suspend per-frame sync for the dragged piece + rebuild on transform

**Files:**
- Modify: `src/render/Scene.tsx`
- Test: manual (covered in Task 7) — this is render-loop wiring

- [ ] **Step 1: Skip sync while dragging** — in `Sim`'s `useFrame`, when driving meshes from State, `if (piece.id === store.getState().transformDraggingId) continue` so `PivotControls` owns that mesh during a drag.
- [ ] **Step 2: Rebuild world on transform commit** — extend `structureKey` (Scene) to include each piece's transform so a committed move/rotate rebuilds the Jolt body at the new pose. Append to the per-piece key: `:${p.state.transform.position.join(',')}:${p.state.transform.rotation.join(',')}`. (Dimensions are already in the key from M2.)
  - **Note:** physics is paused during the drag, so the per-frame State writes don't thrash this key; the rebuild fires once on commit when `running` resumes.
- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: suspend mesh-sync during gizmo drag; rebuild on transform commit"`

---

## Task 4: TransformGizmo component

**Files:**
- Create: `src/render/TransformGizmo.tsx`
- Modify: `src/render/Scene.tsx` (mount for the selected piece)
- Test: logic covered by Task 1; component behavior in Task 7 (manual)

- [ ] **Step 1: Implement `TransformGizmo.tsx`:**
  - Props: `{ piece: Piece }`. Render `<PivotControls anchor={[0,0,0]} depthTest={false} ...>` positioned at the piece's current `state.transform.position`/`rotation`, wrapping a small invisible anchor (the actual `PieceMesh` continues to render in `Sim`; the gizmo just provides handles at the piece location). Use `fixed={false}` and a modest `scale`.
  - `onDragStart`: `const s = store.getState(); s.setTransformDragging(piece.id); wasRunning.current = s.running; s.setRunning(false)`.
  - `onDrag(_l, _dl, w)`: decompose `w` (a `THREE.Matrix4`) via `w.decompose(pos, quat, scl)`; live-apply to the piece's mesh through the store's mesh map is unnecessary — instead update `piece.state.transform` in place each drag so the rendered `PieceMesh` follows (Sim is skipping it, so set the mesh directly via a ref OR mutate state and let the gizmo's own child show it). Simplest: keep a local preview by mutating `piece.state.transform` from the decomposed pose each `onDrag` (position/rotation only; scale shown via annotations).
  - `onDragEnd`: read the final decomposed pose+scale, call `store.getState().updatePiece(piece.id, transformPatch(piece, { position, quaternion, scale }))`, then `s.setTransformDragging(null); s.setRunning(wasRunning.current)`.
  - Enable `annotations` so live size/feedback shows during scale.
- [ ] **Step 2: Mount in Scene** — in `Sim`, when `selectedId` is set and not in `grabMode`, render `<TransformGizmo piece={selectedPiece} />`.
- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: transform gizmo (move/rotate/scale) with auto-pause and commit"`

> **Executor note:** `PivotControls`' exact matrix semantics (local vs world, and whether `autoTransform` must be off to read deltas cleanly) should be confirmed by a quick spike in the running app before finalizing `onDrag`. If controlling via the `matrix` prop is cleaner than decomposing `w`, use that. The committed result (Definition updated, scale→dimensions) is the contract; the wiring may adjust.

---

## Task 5: Inline editable dimensions

**Files:**
- Create: `src/render/DimensionLabels.tsx`
- Modify: `src/render/Scene.tsx`
- Test: `tests/render/dimension-labels.test.tsx` (label values from a piece; pure helper)

- [ ] **Step 1: Write the failing test** — a pure `dimensionEntries(piece)` returns the editable `{ key, value }` list per primitive (box: x/y/z; cylinder: radius/height; sphere: radius).

```ts
import { it, expect } from 'vitest'
import { makePiece } from '../../src/document/catalog'
import { dimensionEntries } from '../../src/render/DimensionLabels'

it('lists editable dimensions per primitive', () => {
  expect(dimensionEntries(makePiece('block', [0,0,0])).map(e => e.key).sort()).toEqual(['x','y','z'])
  expect(dimensionEntries(makePiece('rod', [0,0,0])).map(e => e.key).sort()).toEqual(['height','radius'])
  expect(dimensionEntries(makePiece('ball', [0,0,0])).map(e => e.key)).toEqual(['radius'])
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `dimensionEntries(piece)` from `piece.dimensions` keys. `DimensionLabels.tsx`: for the selected piece, render drei `<Html>` labels near the piece showing each dimension; clicking a label swaps to a number input that calls `updatePiece({ dimensions: { ...piece.dimensions, [key]: value } })` on Enter/blur (clamp to `MIN_DIM`). Mount in `Scene` for the selected piece when not dragging.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: inline editable dimension labels"`

---

## Task 6: Live-intervene grab + Toolbar toggle

**Files:**
- Modify: `src/render/Scene.tsx`, `src/ui/Toolbar.tsx`, `src/physics/integration.ts`
- Test: probe + manual (Task 7)

- [ ] **Step 1: Probe Jolt runtime motion-type switch** — confirm a body can go dynamic→kinematic and back at runtime:
  ```bash
  node --input-type=module -e "import m from 'jolt-physics'; const J=await m(); console.log('SetMotionType', typeof J.BodyInterface?.prototype?.SetMotionType, 'EMotionType_Kinematic', J.EMotionType_Kinematic, 'MoveKinematic', typeof J.BodyInterface?.prototype?.MoveKinematic);"
  ```
  Expected: `EMotionType_Kinematic` defined; `SetMotionType`/`MoveKinematic` exist. If not, fall back to a full rebuild with the grabbed piece anchored.
- [ ] **Step 2: Add a `setKinematicTarget(pieceId, pos)` to `PhysicsWorld`** — sets the body's motion type to kinematic and moves it toward `pos` (via `MoveKinematic` or `SetPositionAndRotation`); a release method restores dynamic. Keep it minimal.
- [ ] **Step 3: Toolbar "✋ Grab" toggle** — bound to `grabMode`/`setGrabMode`.
- [ ] **Step 4: Wire in Scene** — when `grabMode` and `running`, dragging a piece (pointer down on it + move) calls `world.setKinematicTarget(id, pointHit)` each move; on pointer up, release to dynamic. (Gizmo is hidden in grab mode.)
- [ ] **Step 5: Typecheck + full suite.**
- [ ] **Step 6: Commit** — `git commit -m "feat: live-intervene grab (kinematic drag while running)"`

---

## Task 7: Manual verification (browser)

**Files:** none — preview tools.

- [ ] **Step 1:** `npm run dev`; place a piece, select it → the transform gizmo appears at it.
- [ ] **Step 2:** Drag the move handle → physics auto-pauses, the piece moves and snaps; release → it stays and physics resumes from the new pose.
- [ ] **Step 3:** Rotate → orientation changes and persists. Scale a box edge → it resizes; confirm the size annotation updates.
- [ ] **Step 4:** Click an inline dimension label, type an exact value → the piece resizes to it.
- [ ] **Step 5:** Toggle "✋ Grab", press Run, drag a piece while the sim runs → it follows the cursor (kinematic) and shoves neighbors; release → it falls dynamically again.
- [ ] **Step 6:** Per "verify before reporting fixed", only mark done after observing all the above. Append observations to `docs/superpowers/plans/M-Transform-verification-notes.md`.

---

## Out of scope
- Multi-select / group transform (single-select only).
- Rotation/scale numeric typing beyond the dimension labels (rotation stays handle-driven for now).
- Snap-setting UI (grid size remains the existing default).
