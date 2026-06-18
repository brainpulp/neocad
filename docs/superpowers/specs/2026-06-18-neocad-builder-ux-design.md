# NeoCad — Builder UX Hardening Design Spec

**Date:** 2026-06-18
**Status:** Approved for planning
**Scope:** Two sequenced milestones that harden the existing M1/M2 builder before any guidance (§13) or M3 mechanisms work. Stage-1 builder only; no AI.

## Context & motivation

M1 (placement) and M2 (fasteners, proximity fastening, properties, export) are done and verified. The builder is feature-rich but *rough*: you can add pieces but never delete them, overlapping pieces are unclickable, there are no keyboard shortcuts, the empty grid gives no hint, and — most importantly — there is no direct on-object manipulation (move/rotate/scale). The reference for "feels good" is **Tinkercad's direct manipulation**: drag-to-move, rotation handles, and scale handles with **inline editable dimensions**, which the user considers better than most heavyweight CAD.

This work is sequenced **before** the guidance layer (spec §13) and M3 mechanisms: finish the core builder, then coach it, then add motion.

## Milestone split

The two milestones differ greatly in size, so they ship in sequence:

- **M2.5 — Quick wins** (small, ships first): delete, scene tree, keyboard shortcuts, empty-state, selection polish. Each is small and independent; together they stop the tool feeling broken.
- **M-Transform — Direct manipulation** (large, ships second): the Tinkercad-style gizmo, inline editable dimensions, and a live-intervene grab. A real custom-3D-UI effort; its own plan.

Each milestone produces working, verified software on its own.

---

## M2.5 — Quick wins

### Delete
- `Delete`/`Backspace` removes the currently selected piece. Removing a piece already drops any fasteners referencing it (`removePiece`, M2).
- New `removeFastener` store action; fasteners are deleted from their scene-tree row (no separate fastener-selection state needed).
- This closes the most glaring gap: today nothing can be removed.

### Scene tree (right panel, above Properties)
- A list of every **piece** (icon/label + name, e.g. "Rod") and every **fastener** (e.g. "Weld: Rod ↔ Block").
- Clicking a piece row selects it (drives the same `selectedId` used by 3D selection and Properties), keeping tree and viewport in sync.
- Each row has a delete (✕). This is the way to reach pieces that overlap and are unclickable in the 3D view, and the way to delete fasteners.

### Keyboard shortcuts
A global `keydown` handler in `App`, **ignored when focus is in an input/select/textarea** so field typing isn't hijacked:
- `Delete` / `Backspace` → remove selected piece.
- `Esc` → cancel the active stock tool, clear `fastenTool`/`pendingFastenA`, and deselect.
- `Ctrl/Cmd+Z` → undo; `Ctrl/Cmd+Shift+Z` (and `Ctrl+Y`) → redo.

### Empty-state
- When `doc.pieces.length === 0`, a centered, non-interactive hint over the viewport: "Pick a stock from the left to start building." Hidden as soon as a piece exists.

### Selection polish
- Keep the emissive highlight from M2; ensure scene-tree selection and 3D click-selection stay in sync on the single `selectedId`; empty-space click clears via existing `onPointerMissed`.

---

## M-Transform — Direct manipulation

### Physics interaction (the defining wrinkle)
Unlike Tinkercad, NeoCad has **ambient physics**, so manipulation must not fight gravity.
- **Default — auto-pause.** Grabbing any gizmo handle pauses the simulation. Edits write to the selected piece's **Definition** (transform and/or dimensions). On release, State is set equal to Definition and the sim resumes (reusing the `worldEpoch` rebuild path). This realizes the spec's "pause is the modeling aid."
- **Secondary — live intervene.** A toolbar "✋ Grab" toggle: while enabled and the sim is *running*, dragging a piece makes that body **kinematic** and follows the pointer (shove a running build); releasing returns it to dynamic. Intentionally simpler/cruder than the precise gizmo.

### Gizmo (Tinkercad-style bounding-box handles)
- Built on drei `PivotControls` as the handle engine, anchored to the selected piece's bounding box:
  - drag the body → **move** on the ground plane (snap to grid, reusing `snap.ts`);
  - vertical handle → **raise** (Y);
  - curved handles → **rotate** (optional angle snap);
  - corner/edge handles → **scale**.
- **Scale maps to our `dimensions`**, not to a mesh scale: a scale drag updates `dimensions` (box `x/y/z`, cylinder `radius/height`, sphere `radius`), then the gizmo's own scale resets to 1 because the geometry is rebuilt from `dimensions`. This keeps the document's dimensions authoritative and exportable.
- All edits commit to Definition via `updatePiece`.

### Inline editable dimensions
- drei `<Html>` labels positioned along the bounding box show the live dimension(s) while selected.
- Clicking a label turns it into a number input; typing an exact value calls `updatePiece({ dimensions: ... })`. This is the inline-dimension behavior the user specifically praised in Tinkercad.

---

## Architecture & components

Follows existing patterns (Zustand store, R3F scene, `src/ui` panels).

- `src/document/store.ts` — add `removeFastener`; add transform commit helpers if needed (move/scale write through existing `updatePiece`). Selection (`selectedId`) already exists.
- `src/ui/SceneTree.tsx` (new) — pieces + fasteners list with select + delete.
- `src/ui/keyboard.ts` or an `App` effect (new) — global shortcut handler with input-focus guard.
- `src/render/EmptyState.tsx` (new) — viewport hint overlay (drei `<Html>` or a DOM overlay in the viewport container).
- `src/render/TransformGizmo.tsx` (new) — wraps `PivotControls`, maps drags to Definition transform/dimensions, auto-pause on grab/resume on release.
- `src/render/DimensionLabels.tsx` (new) — inline editable dimension labels.
- `src/render/Scene.tsx` — mount gizmo + labels for the selected piece; wire live-grab mode.
- `src/ui/Toolbar.tsx` — add the "✋ Grab" toggle.

### Transform → document mapping (must be pinned in the plan)
- **Move:** new world position → snapped → `definition.transform.position` (and State).
- **Rotate:** gizmo quaternion → `definition.transform.rotation`.
- **Scale:** per-axis scale factor × current dimension → new `dimensions`; clamp to a small positive minimum; reset gizmo scale to 1 afterward.

## Testing

- **Unit/logic (pure, fast):** `removeFastener`; delete-selected behavior; keyboard action mapping (which key → which store action, including the input-focus guard predicate); transform commit math (scale-factor → new dimensions with clamping; move → snapped position; rotate → rotation passthrough); Esc clears tool/fasten/selection.
- **Component (jsdom, mock Scene):** SceneTree renders rows for pieces+fasteners, click selects, ✕ deletes; empty-state shows only when no pieces.
- **Manual (browser, per "verify before reporting fixed"):** gizmo move/rotate/scale on a selected piece; inline-dimension typing changes size; live-grab shoves a running piece; scene-tree select/delete; Delete/Esc/undo shortcuts; empty-state appears on a fresh doc and disappears after first placement. Notes appended to a per-milestone verification file.

## Out of scope
- Guidance Rings 2 & 3 (spec §13) — later Guidance milestone.
- M3 mechanisms (hinge/slider/ball/rope, motors).
- Multi-select / group transform (single-select only here).
- Camera framing / view presets, New/rename-document, snap-setting UI — possible later polish, not in these two milestones.

## Details to resolve during planning
- **PivotControls fit:** confirm `PivotControls` exposes the drag deltas needed to map cleanly to position/rotation/scale, and that auto-pause-on-grab can hook its drag start/end; if it can't, fall back to a thin custom gizmo for the problematic handle(s).
- **Rotation snap:** decide whether rotation snaps to increments (e.g. 15°) and whether snap is modifier-toggled.
- **Live-grab kinematic switch:** confirm switching a Jolt body dynamic↔kinematic at runtime without a full world rebuild (or accept a rebuild).
- **Dimension-label placement:** which dimensions to show per primitive and where (box: 3 edges; cylinder: radius + height; sphere: radius).
