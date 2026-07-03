# SDF-based physics for NeoCad — research report

*2026-07-04 · Question: why does Clavicula's physics look so good, how does SDF
collision actually work, and should NeoCad invest in an SDF evaluator?*

Method: fan-out web research (5 angles, 15 sources fetched, claims extracted and
adversarially verified 3-vote each) + first-hand code reading of two open-source
SDF physics engines + first-hand information from Clavicula's author.
Confidence labels: **[verified]** = survived 3-0 adversarial verification;
**[code-read]** = confirmed by reading the implementation directly;
**[source]** = extracted with quotes but verification was rate-limited;
**[author]** = stated by Lucian Stanculescu (Clavicula's developer) in chat.

## Headline finding: Clavicula's physics is NOT SDF physics

**[author]** Clavicula uses **Bullet** as its physics engine, plus qhull for
convex hulls, Shewchuk's triangle/exact predicates for geometry. SDFs are its
*modeling* representation; simulation is a classic convex rigid-body pipeline —
the same family as NeoCad's Jolt (Jolt being the newer generation).

The "amazingly nice" physics feel therefore comes from the **collision
geometry**, not the solver: SDF-modeled shapes are inherently rounded (every
union blended, every edge filleted), and their convex-hull proxies carry that
rounding into Bullet. Flat contacts work flawlessly there because Bullet
resolves them with ordinary polygonal contact manifolds — the hard flat-face
problem never touches an SDF.

**Action taken:** NeoCad now sets a Jolt *convex radius* (a few mm of built-in
edge rounding, capped at ¼ of the smallest half-extent) on boxes, cylinders and
the wedge hull instead of the old blanket 0. This is the cheapest possible
"Clavicula-ization" of contact feel, and the future fillet/chamfer feature can
ride the same mechanism (bigger convex radius ≈ real fillet's logical collision).

## How real SDF collision works (when engines actually do it)

- **Macklin et al. 2020, "Local Optimization for Robust Signed Distance Field
  Collision"** — the reference technique. Contact between an SDF and a mesh is
  found by a **per-element local optimization** (closest point between the SDF
  isosurface and each triangle), not by point-sampling the surface
  **[verified]**. It produces accurate contacts for sharp point-face pairs and
  smoothly varying edge-edge contact **[verified]** — i.e. the smoothness AND
  sharp handling come from optimization-based contact finding, at real compute
  cost. They compare projected gradient descent, Frank-Wolfe, and
  golden-section search as inner solvers **[verified]**.
- **MuJoCo's SDF plugin** finds contacts by gradient-descent minimization of
  `A + B + |max(A, B)|` over the two fields **[verified]**; because SDFs are
  non-convex it must multi-start from Halton-sequence seeds in the AABB
  intersection, so cost scales with `initpoints × iterations` per pair
  **[verified]**. Contact normals come from the SDF gradient.
- **PhysX 5** ships production SDF collision, but: SDFs are precomputed during
  mesh cooking (sparse grids recommended — dense "use a lot of memory" while
  sparse performs almost identically); dynamic triangle-mesh bodies REQUIRE an
  SDF; and SDF collision runs on the **GPU pipeline** — no CPU/WASM path
  **[source]**. Grid resolution is a hard tradeoff: too coarse and thin parts
  (like NeoCad's panels) simply fail to collide **[source]**.
- **Newton (NVIDIA/Warp)** ships a "Nut Bolt SDF" example — evidence that
  optimization-based SDF contact CAN handle tight engineered fits — but it
  requires a CUDA GPU; design reference only **[source]**.
- A 2025 paper (arXiv 2503.11736) shows a fully analytic, twice-differentiable
  contact formulation whose runtime is independent of contact count and needs
  no convex decomposition **[verified]** — interesting for a differentiable
  future, not a today option.
- **mikolalysenko/sdf-physics** — a WebGPU browser engine where every shape and
  constraint is an SDF: an existence proof for browser SDF dynamics **[source]**.

## What the hobby SDF engines actually do (first-hand code reading)

- **GandalfTheBlu/sdf_physics_engine** **[code-read]**: only spheres and
  capsules are dynamic, colliding against ONE static analytic world-SDF. A
  capsule marches sample points along its axis sphere-tracing style
  (`t += max(step, dist)`), takes the single deepest point; normal = IQ's
  4-tap tetrahedral finite difference (h = 1e-4, 4 extra SDF evaluations);
  response = one-shot impulse with a full K-matrix + friction cone + direct
  positional de-penetration. No manifolds, no iterative solver.
- **TigerFusion/SDF-3D-Physics** **[code-read]**: Minkowski-sum trick (dilate
  one SDF, reduce the other to a sphere), no gradient descent; the README
  itself admits *"flat shapes like boxes do not work as well."*

Both get their smooth look by simulating **round things against smooth fields**
— they never face the flat/sharp engineered-contact problem that is NeoCad's
core case.

## Tradeoffs vs Jolt for engineered parts

| | Jolt-style convex | SDF collision |
|---|---|---|
| Sharp edges, flat stacking | native manifolds, exact | needs Macklin-style optimization or fails/softens |
| Bolt-in-hole fits | exact analytic shapes | possible (Newton demo) but grid resolution limits tolerance |
| Thin stock (12 mm slats) | fine | grid SDFs miss thin features unless resolution ↑↑ |
| Memory | tiny (shape params) | grids: tens of MB unless sparse |
| CPU/WASM 60 Hz, ~100 bodies | proven (we run it) | per-contact gradient descent × multi-start is expensive; no production CPU precedent |
| Organic/rounded shapes | needs hulls/decomposition | native, beautiful |
| Determinism | fixed-dt deterministic | iterative optimization; seeds/iterations must be pinned |

## Recommendation

1. **Do not replace or augment Jolt with an SDF evaluator now.** The thing that
   was admired in Clavicula is achievable inside Jolt (done: convex radius).
   Production SDF contact is GPU-bound (PhysX/Newton) or research-grade on CPU;
   thin stock and tight fits — our bread and butter — are its weakest cases.
2. **Adopt the geometry lesson everywhere**: rounded collision proxies for
   stock; future fillet/chamfer = larger convex radius + filleted hulls;
   future drilling = compound convex pieces (qhull-style decomposition),
   exactly the Clavicula pipeline.
3. **Revisit SDF as a *separate evaluator*** only when the roadmap reaches
   squishy solids / organic shapes / differentiable "analysis mode" — then the
   Macklin per-element optimization (CPU, few bodies) or a WebGPU port
   (mikolalysenko's engine as reference) are the entry points, run as a
   non-realtime or small-scene evaluator behind the same Document interface.

## Sources

- Macklin et al., ACM TOG 2020 — https://dl.acm.org/doi/10.1145/3384538
- MuJoCo extension docs — https://mujoco.readthedocs.io/en/stable/programming/extension.html
- PhysX 5.3/5.4 rigid-body collision docs — https://nvidia-omniverse.github.io/PhysX/
- Newton physics — https://github.com/newton-physics/newton
- arXiv 2503.11736 (analytic smooth dynamics, 2025)
- https://github.com/GandalfTheBlu/sdf_physics_engine (code read)
- https://github.com/TigerFusion/SDF-3D-Physics (code read)
- https://github.com/mikolalysenko/sdf-physics
- Clavicula dependencies: author (Lucian Stanculescu) via user chat; license at
  clavicula.link/archive_clavicula/License.txt (unreachable from CI sandbox)
