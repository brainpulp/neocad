# M2 Verification Notes

**Date:** 2026-06-18
**Branch:** `m2-stable-structures`
**Method:** Vite dev server driven via the browser preview tools (real WebGL).

## Observed behaviors

| Behavior | Result |
|---|---|
| Full M2 shell renders (STOCK + FASTENERS palette, glTF/STL buttons, Properties + Materials editor, fastener count in status bar) | ✅ |
| Place stock; pause | ✅ (`parts` increments; status shows paused) |
| **Proximity fastening** — clicking a stock piece onto an existing piece auto-creates a weld | ✅ (`fasteners` incremented each time; default Weld) |
| Fastener marker renders at the join | ✅ (midpoint; sits inside overlapping pieces) |
| Selection → editable Properties (name, material dropdown, anchored, dimensions) | ✅ |
| Materials editor — add new material ("titanium") | ✅ (appears in list and in the Properties material dropdown) |
| Anchoring a fastened assembly holds it up under gravity (stable structure) | ✅ (anchored rod suspends the welded block+rods instead of collapsing) |
| glTF / STL export buttons | ✅ (no console errors) |

## Fixes/improvements made during verification
- **Robust proximity-on-pointerdown** (`Scene.tsx`): a pointer-down directly on a piece while
  placing now sets the proximity target, so the weld forms even without a preceding hover
  (important for touch and for reliable behavior). Previously the join only formed if a
  `pointermove` had set the target first.
- **Fastener count in the status bar** (`StatusBar.tsx`, spec §7) — also the signal used to
  confirm welds form during verification.

## Coverage notes
- The proximity-fastening *logic* (proximity-commit creates a weld; `nearestPiece` helper) and
  the *physics* (a weld holds a hanging piece up when its partner is anchored) are covered by
  unit tests (49 → 49 passing). Precise 3D *hover* could not be auto-driven via synthetic events
  (R3F reads `offsetX`, which synthetic PointerEvents can't set) — verified instead via real
  harness clicks landing on a piece, confirmed by the incrementing fastener count.

## Known M2 limitations (deferred, by design)
- Guidance Rings 2 (rule-based nudges) & 3 (LLM) — separate Guidance milestone.
- Dragging *existing* pieces to re-trigger proximity joins (M2 fires at placement time).
- Physics world fully rebuilds on structural change (perf TODO).
- Fastener marker is hidden when the two pieces overlap (cosmetic).
