# Materials roadmap — properties, soft bodies, heat, liquids (2026-07-04)

Agreed direction: materials stop being paint + density and become the physics.
Honest feasibility assessment per phase; each phase ships browser-verified.

## Phase 1 — M-Materials1: forces & light (SHIPPED with this note)

| Property | Status | How |
|---|---|---|
| Friction coefficient | ✅ live | per-material, honest values, Jolt `mFriction` (was already wired) |
| Bounciness (restitution ≈ durometer) | ✅ live | per-material; the global 0.4 clamp that made rubber thud is lifted to 0.88 |
| Ferromagnetism + magnets | ✅ live | `magnetic: 'magnet' \| 'ferrous'`; 'magnet' material added; per-step force pass: point-DIPOLE magnet↔magnet (flip a magnet → it repels), induced attraction magnet↔ferrous (steel, cast-iron); softened 1/r², 260 N cap, 2 m range |
| Transparency / translucency / refraction | ✅ live | `optics: {transmission, ior, roughness}` → MeshPhysicalMaterial transmission; glass (ior 1.5), ice (1.31, frosty), acrylic (1.49) |

Deferred within phase 1: magnet TORQUE (poles turning to face each other),
per-material property sliders in the materials editor, magnetic strength slider.

## Phase 2 — M-Soft: soft bodies & deformation

- **Elasticity**: rubber/foam pieces compile to Jolt SOFT-BODY volumes (the rope
  system already proves the soft-body path end to end). Stiffness from
  youngsModulus-ish parameter; squash under load, jiggle on impact.
- **Plasticity**: permanent deformation — on large strain, adopt the deformed
  shape as the new rest shape (document stays the source; the piece carries a
  deformation state like ropes carry none — decision needed on persistence).
- **Brittleness**: rigid pieces pre-fractured into convex chunks (Voronoi) at
  compile; impact impulse over a material threshold releases the chunks.
  Glass/ceramic/brick shatter honestly. (Pairs with impact-sound system.)
- Risks: soft-body collision quality vs thin stock; chunk count vs perf.
  All rigid-body machinery (joints, fasteners) stays rigid-only at first.

## Phase 3 — M-Heat: temperature as evaluation state

- Per-piece temperature (evaluation state, NOT persisted — like rope particles).
- **Heat conductivity** per material; conduction through the CONTACT graph
  (the contact listener already reports touching pairs) + slow ambient loss.
- Heat sources: a burner/torch tool; friction heating later.
- **Melting point**: pieces soften (Phase-2 soft body with falling stiffness),
  then slump/shrink away. **Ignition temperature**: flag + fire PARTICLES.
- Visuals: temperature glow ramp (black-body tint), smoke/steam sprites.
- Particle system (fire/smoke/steam) is render-layer only — cheap sprites,
  no physics coupling in v1.

## Phase 4 — M-Liquids (experimental, scoped honestly)

- v1: particle blobs — a few hundred small spheres with cohesion + low
  friction, bucket/pour tool, screen-space metaball-ish rendering later.
  CPU/wasm budget caps this around ~500–1500 particles; it will read as
  "playable goo", not a river. Buoyancy: density-based lift for pieces in a
  liquid volume.
- v2 (own spec, GPU): position-based fluids in WebGPU/compute shaders if the
  project wants real water. Not promised until v1 teaches us the UX.

## Order & rationale

1 (done) → 2 (soft bodies unlock plasticity + brittleness + melting's slump)
→ 3 (heat rides on contact graph + soft bodies) → 4 (liquids last; costliest,
benefits from particle/render infra built in 3).
