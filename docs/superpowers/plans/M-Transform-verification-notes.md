# M-Transform Verification Notes

**Date:** 2026-06-18
**Branch:** `m-transform` (NOT yet merged — awaiting human hands-on check)
**Method:** Vite dev server via browser preview tools + unit tests.

## Verified (automated / observable)

| Item | Result |
|---|---|
| Transform math (`transformPatch`): snapped move, rotation passthrough, scale→dimensions per primitive, clamp | ✅ unit-tested (6 cases) |
| `dimensionEntries` per primitive | ✅ unit-tested |
| Store drag/grab state (`transformDraggingId`, `grabMode`) | ✅ unit-tested |
| Gizmo renders with full handles (move arrows, rotate arcs, scale spheres, plane sliders) on the selected piece | ✅ screenshot |
| Inline dimension labels render above the selected piece (`x 0.30 y 0.30 z 0.30`) | ✅ screenshot |
| `✋ Grab` toolbar toggle renders | ✅ screenshot |
| No console errors on fresh load with the full feature set | ✅ |
| Full test suite | ✅ 68 passing |
| Spurious zero-movement "drag" no longer commits (drift guard) | ✅ code (moved-ref guard) |

## NOT auto-verified — needs a human at the mouse

The actual **dragging** of gizmo handles and the **kinematic grab** cannot be driven by
the preview tools: react-three-fiber computes the pointer from `event.offsetX`, which
synthetic `PointerEvent`s can't set, so programmatic drags don't reach the 3D handles.
(Same limitation documented in M2.) These need a real mouse to confirm:

- Drag move/raise → piece moves & snaps; physics auto-pauses on grab, resumes on release.
- Rotate handle → orientation changes and persists.
- Scale handle → piece resizes; dimensions update; annotation shows size.
- Click an inline dimension label, type a value → piece resizes to it.
- `✋ Grab` + Run, drag a piece → it follows the cursor (kinematic) and shoves neighbors; release → falls dynamically.

## How to check (1 minute)
`npm run dev` → place a Block → click it → drag the colored handles; try the dimension
labels; toggle ✋ Grab, press Run, drag the block around.

## Known notes
- HMR (hot reload) sometimes corrupts the R3F canvas after editing gizmo code; a full page
  reload fixes it. Fresh loads are clean — this is dev-only, not a production issue.
- Gizmo uses drei `PivotControls` (Tinkercad-style); it requires a child node to anchor
  (an invisible mesh is provided).
- A pre-guard test left one block at x≈0.29999/z≈0.30002 (float drift); cosmetic, and the
  guard prevents recurrence.
