# NeoCad Backlog

Living list of work. M-numbers are Stage 1 milestones from the spec
(`docs/superpowers/specs/2026-06-17-neocad-stage1-design.md`).

## Done

- **M1 — Playful building** ✅ (verified 2026-06-17, see `plans/M1-verification-notes.md`)
  - Project scaffold, document model, stock catalog, serialize round-trip, undo/redo store
  - Jolt integration layer (fixed-dt, deterministic), render from State, app shell
  - Held-piece placement, play/pause/reset, IndexedDB autosave, file save/open

## Next up — M2: Stable structures (NEEDS A PLAN)

- Anchoring UX (toggle a piece as anchored from the Properties panel)
- Rigid fasteners: **weld, glue, bolt, nail** (all map to a fixed constraint in v1;
  distinct names now, diverging strengths later)
- Two-piece fastening interaction (select A, select B, choose fastener)
- Stable-structure demo: build a table/frame that stands; a bad one topples
- Properties panel editing: dimensions, material dropdown, position/rotation
- Materials editor UI: edit presets + create new materials
- glTF export (GLTFExporter) and STL export (geometry only)

## Later — M3: Mechanisms

- Articulated fasteners: **hinge** (revolute), **slider** (prismatic), **ball/pin**, **rope/cable**
- **Motors**: powered hinge/slider (axle/wheel) with targetVelocity + maxForce
- Demos: pulley lifting a weight; driven cart on a ramp
- Incremental physics-world updates (avoid full rebuild on every structural change)
- Rope state serialization (define node-position vs rest-length representation)

## Cross-cutting / tech debt

- Code-split / lazy-load the ~4MB Jolt WASM (currently one big chunk)
- Scene-tree panel listing all pieces; click-to-select in viewport
- Selection model (currently Properties is a stub; no real selection yet)
- Snap controls (grid size, toggle) surfaced in UI (currently fixed 0.1m)
- Friendlier first-run (empty-state hint to pick a stock)

## Stage 2 (separate spec, deferred)

- AI-assisted natural-language → design, validated by the constraint framework
- Future evaluators on the same document: soft-body deformation, FEA stress/failure
  (materials table already reserves youngsModulus/yieldStrength/poissonRatio)
