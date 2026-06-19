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

---

## 2026-06-19 — Hands-on outcome: NOT ready to merge (3 interlocking problems)

A human mouse-check found the transform UX does **not** work well. Automated layers stay
green (68/68 tests; clean browser mount via neocad's own vite — the preview MCP's bundled
vite hits `EPERM` writing temp dirs inside Google Drive, so use `npm run dev` directly).
The branch shipped the transform *mechanism* but not the *physics-aware behavior*, which is
the hard part. Three root causes, grounded in the code:

1. **Dimension labels are in the way — badly located & sized.**
   `DimensionLabels.tsx` dumps all dimensions into a single drei `<Html>` clump pinned at a
   fixed `py + 0.4` above the piece center (so buried inside large pieces, floating far from
   small ones) and sized by an arbitrary `distanceFactor={6}`. Labels aren't anchored to the
   edges they measure and don't scale with the piece.
   → Fix direction: anchor each label to its axis/edge with size derived from the piece's
   bounding box, or move dimension editing into the Properties panel.

2. **Dragging a piece drags the weld marker, and "everything flies."** Two causes:
   - `FastenerMarker.tsx` recomputes the fastener midpoint every frame, so dragging piece A
     slides the orange marker toward it — cosmetic but confusing.
   - **The real bug:** transforming one piece of a *welded assembly* ignores the fastener.
     A moves alone, B stays; on release the world fully rebuilds (`Scene.tsx` `structureKey`
     includes transform) and the `FixedConstraint` is recreated with `mAutoDetectPoint`
     (`integration.ts:64`) at wherever A landed. Nothing checks for overlap, so A can be
     dropped intersecting B or the ground → on resume Jolt's constraint+collision solver
     violently corrects → "all flies."
   → Fix direction: when the selected piece is fastened, transform the whole rigid assembly
     together (or offer to break the weld); reject/snap overlapping poses on commit.

3. **No difference between contact and floating.**
   The proximity/contact affordance (`proximity.ts` + the `proximityTarget` highlight) only
   runs during *placement* (`activeTool` set), never during a gizmo transform
   (`Scene.tsx` `onPointerMove`). So dragging near a surface gives no snap and no highlight,
   and a piece left mid-air looks identical to one resting on another. This missing
   surface-snap is also what would prevent the overlap-explosion in #2.

**These are interlocking** — the contact/snap work (#3) underpins the explosion fix (#2).
Treat as a "physics-aware transform" redesign, not three isolated tweaks. Approach was not
yet chosen (plan-first vs. fix-in-priority-order vs. rethink the free-gizmo model for a
weld-based assembler).

**Install gotcha:** `npm install` pauses on esbuild/fsevents install-script approval; approve
them or `vitest`/`vite` won't be on PATH.
