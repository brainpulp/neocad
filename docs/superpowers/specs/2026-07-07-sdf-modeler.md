# SDF Modeler (branch `sdf-core`)

Status: **in progress** · Branch: `sdf-core` (off the builder HEAD, not stale `main`) ·
No physics, no builder-UI changes on this branch.

## Why

Primitive-assembly + Jolt collision can't express **cuts, booleans, fillets/chamfers,
or freeform shapes**. Those need an implicit representation. This branch builds a
**signed-distance-field (SDF) geometry core** in isolation so it can iterate without
the physics world's rebuild/fixed-dt constraints.

Primary product surface (near term): **M-Cuts** — drilling holes, negative shapes,
rounded/filleted stock that feed back into the builder as a new body type.
Secondary (later): a **freeform** SDF tool (smooth blends, organic shapes). The core
is built general enough for both; only the product surface differs.

Aligns with `2026-07-04-hollow-holes-rendering.md`, which already frames M-Cuts as
SDF-meshed and the core as a slice.

## Non-goals (this branch)

- Physics integration (meshed cut bodies → Jolt) — a later slice back on the builder.
- Any change to the existing builder App, document model, or store.
- Manufacturing/toolpath concerns.

## Architecture — `src/sdf/` (pure, three-free core + a thin viewer)

- **`tree.ts`** — the SDF node tree (discriminated union), pure data:
  - Primitives: `sphere`, `box`, `roundBox`, `cylinder`, `torus`, `plane`.
  - Ops: `union`, `subtract`, `intersect`, and smooth variants (`smoothUnion` etc.)
    with a blend radius `k`.
  - Transform: `transform` node (translate + rotate quat + uniform scale) wrapping a child.
  - Builder helpers (`sphere(r)`, `box([x,y,z])`, `subtract(a,b)`, `translate(v,a)`…)
    so trees read like code.
- **`eval.ts`** — CPU evaluator `sdf(node, p): number` returning the (near-)exact signed
  distance. Used by tests, the future mesher, and any CPU sampling. Uniform-scale only
  (non-uniform scale breaks the distance metric — deliberately excluded).
- **`glsl.ts`** — `sdfToGlsl(node)` → GLSL source for `float map(vec3 p)`, so the same
  tree drives a live **raymarch** preview. CPU eval and GLSL must agree (a shared set of
  primitive/op formulas keeps them in lockstep).
- **`mesh.ts`** (Phase 3) — `sdfToGeometry(node, {bounds, res})` → `THREE.BufferGeometry`
  via **surface nets** (crisper edges than marching cubes on machined shapes). This is
  what physics/glTF/STL will consume at integration time.
- **Viewer** — dev-only. `main.tsx` renders `<SdfApp/>` instead of the builder when the
  URL has `?sdf`. `SdfViewer.tsx` raymarches a demo tree full-screen with orbit controls.
  Throwaway scaffolding, not a second product.

## Phases (each ships green; SDF distances are numbers → strong TDD fit)

1. **Tree + CPU eval + GLSL codegen** (+ raymarch viewer stub). ← this drop
2. **Viewer polish** — editable demo trees, normals via gradient, basic shading.
3. **Mesher** — surface nets; tests: sphere watertight + correct bounds; `box − cylinder`
   has an actual hole.
4. **Integration slice** (back on builder, behind a flag) — an `sdf`/`cut` body type whose
   render + export + physics geometry comes from the mesher. Drilling = subtract a cylinder.

## Known integration cost (budget for Phase 4, not now)

A subtracted shape is **concave**. Jolt takes concave as a static `MeshShape` fine; a
*dynamic* cut body needs **convex decomposition**. Isolating the core sidesteps this until
we choose to pay it.

## Decision: manifold-3d is the M-Cuts engine (not hand-rolled SDF meshing)

After Phase 1, we benchmarked buy-vs-build on the canonical M-Cut (a 2×2×2 block
with a Ø0.5 bore) across three libraries, measured in Node:

| | manifold-3d | three-bvh-csg | isosurface (SDF→surface nets) |
|---|---|---|---|
| Watertight / 2-manifold | **100%** | ~37% (T-junctions) | 100% |
| Boundary (crack) edges | **0** | ~980 | 0 |
| Triangles | **272** | 715 | 9.6k @32³ · 39k @64³ |
| Time | 13 ms | 68 ms | 63–250 ms |
| Edges | exact sharp | sharp *visually*, non-manifold | rounded |
| three coupling | none | needs three ≥0.179 (we're on 0.169) | none |
| Bundle | 532 KB wasm | native | ~5 KB |

**Chosen: manifold-3d.** Exact watertight booleans → physics + STL "just work";
~35× fewer triangles than surface-nets; edges stay sharp (a drilled hole *looks*
drilled). `three-bvh-csg` is fast but emits non-manifold T-junction meshes (bad
for slicing/physics) and would force a three upgrade. SDF surface-nets rounds
sharp edges — a *feature* for freeform, a *bug* for machined stock.

**Role split (they coexist, unified at the mesh):** manifold-3d is the exact
"machinist" trunk (cuts/unions/watertight solids → export/physics); the SDF core
is the "sculptor" branch for smooth blends / offsets-shells / freeform, which
*meshes into* manifold when mixed. Only mixing paradigms inside one part crosses
a lossy field↔mesh seam; pure-cut and pure-blend chains stay exact.

`src/sdf/csg.ts` — manifold-3d wrapper: op-tree (box/cylinder(Y-axis)/sphere +
subtract/union/intersect + transform) → watertight `BufferGeometry`, singleton
WASM init (`locateFile` for Vite, on-disk for Node). `CsgViewer.tsx` renders real
lit meshes at `?csg` (flat-shaded for crisp facets). 2 tests assert the drilled
block is 2-manifold, <1000 tris, sharp 2×2×2.

## Verification

- Unit tests on CPU eval (known distances: point outside/inside/on-surface of each
  primitive; union = min, subtract = max(a,−b), intersect = max; smooth-op monotonicity).
- GLSL codegen: compiles + numerically matches CPU eval at sampled points (Phase 2, via
  the viewer / a headless GL check).
- Mesher (Phase 3): watertight, bounded, hole-present assertions.
