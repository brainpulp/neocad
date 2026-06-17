# M1 Verification Notes

**Date:** 2026-06-17
**Branch:** `m1-playful-building`
**Method:** Vite dev server driven via the browser preview tools (real WebGL, not jsdom).

## Observed behaviors

| Behavior | Result |
|---|---|
| App shell renders (toolbar, stock palette ×8, viewport, properties, status bar) | ✅ |
| Select stock tool (Block) highlights as active | ✅ |
| Click viewport places a held piece; it drops and rests on the ground | ✅ (`parts: 1`, wood-colored cube resting on grid) |
| Material color + lighting/shadows render | ✅ (wood brown, shaded faces) |
| Stacking — multiple pieces dropped at same spot form a tower | ✅ (`parts: 3`, stacked) |
| Undo removes last piece | ✅ (`parts: 3 → 2`) |
| Pause freezes simulation; button toggles ▶ Run / ⏸ Pause; status shows paused | ✅ |
| Autosave + restore across full page reload | ✅ (`parts: 2` restored from IndexedDB after `location.reload()`) |

## Fix made during verification
- `HeldPiece` pointer-catcher plane was `visible={false}`; three.js skips invisible
  meshes during raycasting, so pointer events never fired. Changed to a transparent
  (`opacity 0`, `depthWrite false`) but visible plane so placement works.

## Automated tests
- 23 unit/integration tests passing (`npm test`), including the deterministic
  dropped-block rest-position test and a same-runs-identical determinism check.
- Production build succeeds (`vite build`); Jolt WASM bundles.

## Known M1 limitations (deferred, by design)
- Physics world fully rebuilds on any structural change (perf TODO for later milestones).
- No fasteners/joints yet (M2/M3). No properties editing yet (M2).
- Bundle is large (~4MB Jolt WASM); code-splitting deferred.
