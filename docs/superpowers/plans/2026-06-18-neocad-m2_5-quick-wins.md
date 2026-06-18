# NeoCad M2.5 — Builder UX Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing builder stop feeling broken — add delete (pieces & fasteners), a scene tree, keyboard shortcuts, an empty-state hint, and selection sync.

**Architecture:** Small additions to the existing Zustand store + React UI panels + R3F scene. No new hard problems; reuses `selectedId`, `removePiece`, `updatePiece`, and the existing pure document ops.

**Tech Stack:** Same as M1/M2 (Vite + React + TS + Three.js/R3F + Zustand + Vitest).

**Reference spec:** `docs/superpowers/specs/2026-06-18-neocad-builder-ux-design.md` (M2.5 section).

---

## File Structure

```
src/document/store.ts     # + removeFastener action
src/ui/SceneTree.tsx       # NEW: list of pieces + fasteners, select + delete rows
src/ui/keyboard.ts         # NEW: pure key→action mapping + input-focus guard
src/ui/App.tsx             # mount SceneTree; install global keydown handler
src/render/EmptyState.tsx  # NEW: viewport hint overlay when no pieces
src/render/Scene.tsx       # render EmptyState overlay
src/ui/app.css             # scene-tree + empty-state styles
tests/...
```

---

## Task 1: `removeFastener` store action

**Files:**
- Modify: `src/document/store.ts`
- Test: `tests/document/remove-fastener.test.ts`

The pure op `removeFastener(doc, id)` already exists in `src/document/document.ts`; this wires a store action (undoable via `commit`).

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect } from 'vitest'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'

it('removeFastener deletes a fastener and is undoable', () => {
  const s = createDocStore()
  const a = makePiece('joist', [0, 1, 0]); const b = makePiece('joist', [0, 2, 0])
  s.getState().addPiece(a); s.getState().addPiece(b)
  s.getState().setFastenTool('weld')
  s.getState().fastenClick(a.id); s.getState().fastenClick(b.id)
  const fid = s.getState().doc.fasteners[0].id
  s.getState().removeFastener(fid)
  expect(s.getState().doc.fasteners).toHaveLength(0)
  s.getState().undo()
  expect(s.getState().doc.fasteners).toHaveLength(1)
})
```

- [ ] **Step 2: Run, verify fails** — `npx vitest run tests/document/remove-fastener.test.ts` → FAIL (`removeFastener` not a function).
- [ ] **Step 3: Implement** — in the store's `DocState` interface add `removeFastener: (id: string) => void`; in the returned object add `removeFastener: (id) => commit((doc) => ops.removeFastener(doc, id)),` (near `removePiece`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: removeFastener store action"`

---

## Task 2: Keyboard action mapping (pure)

**Files:**
- Create: `src/ui/keyboard.ts`
- Test: `tests/ui/keyboard.test.ts`

Pure functions so the mapping is fully unit-tested without DOM. The `App` effect (Task 5) just dispatches.

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect } from 'vitest'
import { isEditableTarget, keyToAction } from '../../src/ui/keyboard'

it('maps keys to actions', () => {
  expect(keyToAction({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('delete')
  expect(keyToAction({ key: 'Backspace', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('delete')
  expect(keyToAction({ key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('cancel')
  expect(keyToAction({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('undo')
  expect(keyToAction({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true })).toBe('redo')
  expect(keyToAction({ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('redo')
  expect(keyToAction({ key: 'a', ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull()
})

it('treats inputs/selects/textareas as editable so shortcuts are ignored there', () => {
  expect(isEditableTarget({ tagName: 'INPUT' } as any)).toBe(true)
  expect(isEditableTarget({ tagName: 'SELECT' } as any)).toBe(true)
  expect(isEditableTarget({ tagName: 'TEXTAREA' } as any)).toBe(true)
  expect(isEditableTarget({ tagName: 'DIV' } as any)).toBe(false)
  expect(isEditableTarget(null)).toBe(false)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `keyboard.ts`:

```ts
export type KeyAction = 'delete' | 'cancel' | 'undo' | 'redo'

interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export function keyToAction(e: KeyLike): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'z' || e.key === 'Z')) return e.shiftKey ? 'redo' : 'undo'
  if (mod && (e.key === 'y' || e.key === 'Y')) return 'redo'
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete'
  if (e.key === 'Escape') return 'cancel'
  return null
}

export function isEditableTarget(el: { tagName?: string } | null): boolean {
  if (!el || !el.tagName) return false
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: pure keyboard action mapping"`

---

## Task 3: Scene tree component

**Files:**
- Create: `src/ui/SceneTree.tsx`
- Test: `tests/ui/scenetree.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { SceneTree } from '../../src/ui/SceneTree'

function setup() {
  const store = createDocStore()
  const a = makePiece('block', [0, 1, 0]); const b = makePiece('rod', [0, 2, 0])
  store.getState().addPiece(a); store.getState().addPiece(b)
  store.getState().setFastenTool('weld')
  store.getState().fastenClick(a.id); store.getState().fastenClick(b.id)
  render(<StoreContext.Provider value={store}><SceneTree /></StoreContext.Provider>)
  return { store, a, b }
}

it('lists a row per piece and per fastener', () => {
  setup()
  expect(screen.getByText('Block')).toBeInTheDocument()
  expect(screen.getByText('Rod')).toBeInTheDocument()
  expect(screen.getByText(/Weld/)).toBeInTheDocument()
})

it('clicking a piece row selects it', () => {
  const { store, a } = setup()
  fireEvent.click(screen.getByText('Block'))
  expect(store.getState().selectedId).toBe(a.id)
})

it('clicking a piece row delete (✕) removes it', () => {
  const { store } = setup()
  // delete buttons are labelled by aria-label "delete <name>"
  fireEvent.click(screen.getByLabelText('delete Block'))
  expect(store.getState().doc.pieces.find((p) => p.name === 'Block')).toBeUndefined()
})

it('clicking a fastener row delete removes the fastener', () => {
  const { store } = setup()
  fireEvent.click(screen.getByLabelText(/delete fastener/i))
  expect(store.getState().doc.fasteners).toHaveLength(0)
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `SceneTree.tsx`: read `doc.pieces`, `doc.fasteners`, `selectedId`. Render a "SCENE" labelled section:
  - For each piece: a row with the piece `name`, `onClick` → `select(piece.id)`, an `active` class when selected, and a `✕` button (`aria-label={`delete ${piece.name}`}`) → `removePiece(piece.id)` (stop propagation so it doesn't also select).
  - For each fastener: a row labelled `${FASTENERS[f.type].label}: ${pieceName(partA)} ↔ ${pieceName(partB)}` and a `✕` button (`aria-label={`delete fastener ${f.id}`}`) → `removeFastener(f.id)`. Resolve piece names from `doc.pieces`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: scene tree with select + delete"`

---

## Task 4: Empty-state overlay

**Files:**
- Create: `src/render/EmptyState.tsx`
- Modify: `src/render/Scene.tsx`
- Test: `tests/render/empty-state.test.tsx`

EmptyState is a plain DOM overlay (absolutely positioned in the `.viewport` container), not an R3F element — so it's testable in jsdom and needs no WebGL.

- [ ] **Step 1: Write the failing test**

```tsx
import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { EmptyState } from '../../src/render/EmptyState'

it('shows the hint when there are no pieces', () => {
  const store = createDocStore()
  render(<StoreContext.Provider value={store}><EmptyState /></StoreContext.Provider>)
  expect(screen.getByText(/pick a stock/i)).toBeInTheDocument()
})

it('renders nothing once a piece exists', () => {
  const store = createDocStore()
  store.getState().addPiece(makePiece('block', [0, 1, 0]))
  const { container } = render(<StoreContext.Provider value={store}><EmptyState /></StoreContext.Provider>)
  expect(container.textContent).toBe('')
})
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — `EmptyState.tsx`: `const n = useDocStore(s => s.doc.pieces.length); if (n) return null; return <div className="empty-state">Pick a stock from the left to start building.</div>`. In `Scene` (or the App `.viewport` wrapper), render `<EmptyState />` as a sibling overlay of `<Canvas>` — put it in the `.viewport` div in `App.tsx` so it's plain DOM, NOT inside `<Canvas>`. Add `.empty-state` CSS (absolute, centered, `pointer-events: none`, muted).
  - **Note:** mount `<EmptyState />` inside the `.viewport` div in `App.tsx` alongside `<Scene />`, not inside `Scene`'s Canvas.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: empty-state hint overlay"`

---

## Task 5: Wire scene tree, empty-state, and global shortcuts into App

**Files:**
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Test: covered by component tests above + manual (Task 6)

- [ ] **Step 1: Mount SceneTree + EmptyState** — in `App.tsx`, add `<SceneTree />` to the `.rightpanel` (above `<Properties />`), and `<EmptyState />` inside the `.viewport` div next to `<Scene />`.

- [ ] **Step 2: Install the global keydown handler** — add an effect in `App`:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target as Element | null)) return
    const action = keyToAction(e)
    if (!action) return
    e.preventDefault()
    const s = store.getState()
    if (action === 'delete') { if (s.selectedId) s.removePiece(s.selectedId) }
    else if (action === 'cancel') { s.setActiveTool(null); s.setFastenTool(null); s.select(null) }
    else if (action === 'undo') s.undo()
    else if (action === 'redo') s.redo()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [store])
```
(Import `keyToAction`, `isEditableTarget`. Note `setFastenTool(null)` also clears `pendingFastenA` per the store; `setActiveTool(null)` clears `fastenTool` — calling both plus `select(null)` covers cancel.)

- [ ] **Step 3: Add CSS** — `.scenetree` rows (`.tree-row`, `.tree-row.active`, `.tree-row button`), `.empty-state` overlay. Match the existing dark theme.

- [ ] **Step 4: Typecheck + full suite** — `npx tsc --noEmit` (expect clean) and `npx vitest run` (all pass).

- [ ] **Step 5: Commit** — `git commit -m "feat: wire scene tree, empty-state, and keyboard shortcuts into App"`

---

## Task 6: Manual verification (browser)

**Files:** none (verification only) — use the preview tools.

- [ ] **Step 1:** `npm run dev`; confirm the empty grid shows the "Pick a stock…" hint.
- [ ] **Step 2:** Place a couple of pieces and weld them; confirm the hint disappears and the scene tree lists the pieces + the weld.
- [ ] **Step 3:** Click a piece row in the tree → confirm it selects (highlight + Properties populate). Click an overlapping piece via the tree that you couldn't click in 3D.
- [ ] **Step 4:** Press `Delete` with a piece selected → it's removed (and its fasteners). Press `Ctrl+Z` → it comes back.
- [ ] **Step 5:** Delete a fastener via its tree row ✕ → fastener count drops.
- [ ] **Step 6:** With a stock tool active, press `Esc` → tool deactivates. Select a piece, `Esc` → deselects.
- [ ] **Step 7:** Per the project's "verify before reporting fixed" rule, only mark M2.5 done after observing all the above. Append observations to `docs/superpowers/plans/M2.5-verification-notes.md`.

---

## Out of scope (→ M-Transform plan)
- Move/rotate/scale gizmo, inline editable dimensions, live-intervene grab.
