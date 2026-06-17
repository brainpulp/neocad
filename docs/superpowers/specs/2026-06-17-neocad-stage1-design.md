# NeoCad — Stage 1 Design Spec

**Date:** 2026-06-17
**Status:** Approved for planning
**Scope:** Stage 1 only (the physics-aware builder's sandbox). Stage 2 (AI-assisted design) is deliberately deferred to its own future spec.

---

## 1. Vision & Framing

NeoCad aims to let anyone with a hardware idea model it directly — collapsing the distance between hardware design and visual art, and removing the need for CAD-expert intermediaries. The full vision is a two-stage system:

- **Stage 1 — Physics-aware builder's sandbox (this spec).** A web app where makers assemble real-world stock (rods, joists, panels) using real-world fasteners (welds, bolts, hinges, axles, ropes) and watch it behave under live rigid-body physics. Deterministic, testable, shippable on its own.
- **Stage 2 — AI-assisted design (future, separate spec).** Natural language → manufacturable designs, validated against the same physical constraint framework Stage 1 establishes.

Stage 1 is explicitly the **test bed** for Stage 2. It must be compelling on its own merits without any AI.

### Target audience (first)
People who **intend to build** — makers, tinkerers, DIY/woodworkers, fabricators. This drives a core product decision: the user-facing vocabulary mimics the real world (stock and fasteners), never abstract geometry or physics jargon.

---

## 2. Core Architectural Principle

**The design document is the single source of truth. Physics is a disposable, pluggable *evaluation* of the document — not the document itself.**

This principle does three jobs:
1. Makes save/load deterministic and clean.
2. Lets physics be the ambient mode while the document stays authoritative.
3. Enables future evaluators (soft-body deformation, FEA stress/failure) to read the *same* document and return different results (motion, stress heatmaps, pass/fail) **without changing the document model**.

### The document has two halves
- **Definition (stable):** which pieces exist, their stock type/dimensions/material, how they're fastened together, anchoring, motor settings, rest lengths. Edited by the user.
- **State (live, multi-valued):** current transforms and poses — joint angles, rope configurations, resting positions. Advanced by physics each frame, frozen on pause, persisted on save.

Many things legitimately have **more than one valid state** (a hinge's angle, a rope's configuration), so State is real design data, not throwaway. Physics feeds State back into the document continuously.

---

## 3. Interaction Model

**Physics is always on (ambient). Pause is the modeling aid.**

Three levels of control:
1. **Held piece → inert.** The piece you're actively placing is a ghost: gravity/collisions don't act on it, it snaps to surfaces/grid for precise aiming. On **release/commit** it becomes a live dynamic body and the running world takes over. This makes placement calm by default — no mode switch needed.
2. **▶ Running.** Everything live; watch it behave.
3. **⏸ Pause.** Freezes the whole assembly for careful multi-piece editing or connecting fasteners. Resume hands the frozen state back to the simulation.

Saving can capture either a settled rest pose or a mid-motion pose (whatever is current), since State is included.

---

## 4. Physics Scope (v1)

**Rigid-body dynamics only:** collisions, gravity, friction, stacking, joints/hinges/sliders, motors, ropes. Things fall, topple, swing; mechanisms work.

**Explicitly out of v1:**
- Static stability verdicts / load analysis.
- Material stress / flexing / breaking (FEA).
- Soft-body deformation.

These are future *evaluators* added later via the pluggable-evaluation principle (§2). They are not engine changes to the rigid-body sim.

No AI, no suggestions, no rule-based hints in Stage 1 — pure deterministic playground.

---

## 5. Technology Choice

- **Rendering:** Three.js (with React Three Fiber where it helps) + React for the UI-state-heavy shell.
- **Physics engine:** **Jolt, used directly via `JoltPhysics.js`** — *not* via the alpha `react-three-jolt` wrapper.
  - Rationale: Jolt-the-engine is AAA-grade (Horizon Forbidden West, Death Stranding 2), has built-in **soft bodies** (the future live-deformation path), and strong joints/motors/vehicles. The React wrapper is phase-0/alpha (missing kinematic rigs, etc.), so we avoid depending on it.
  - Because NeoCad compiles its document into the physics world **imperatively** (not via declarative `<RigidBody>` JSX), the immature declarative wrapper is the part we'd use least anyway.
- **Build/deploy:** Vite → **static site, deployable to GitHub Pages**. No backend, no accounts.

### Accepted cost / risk
Using Jolt directly means we **own a bespoke "physics integration layer"** (document → Jolt bodies/constraints/motors; per-frame transform sync back into State/Three.js; body lifecycle; picking). This is the riskiest code in the project and gets dedicated tests (§9).

---

## 6. Domain Model

The app reads/writes a plain serializable JSON document. Two conceptual layers:

### 6a. Engine primitives (hidden from the user)
- **Primitive shapes:** `box | cylinder | sphere`, with per-shape dimensions.
- **Constraint types:** `fixed | revolute | prismatic | ball | rope | anchor-to-world`, with optional **motor** (`targetVelocity`, `maxForce`) on revolute/prismatic.

### 6b. Catalog (what the user actually sees)
The catalog is a vocabulary/preset layer mapping real-world names onto engine primitives. **Renaming/relabeling, not an engine change.**

**STOCK** (build *with*) → primitive:
| Name | What it is | Primitive |
|---|---|---|
| Rod | solid round bar | cylinder |
| Tube / Pipe | hollow round | cylinder |
| Dowel | thin round peg | cylinder |
| Slat / Board | flat thin plank | box |
| Joist / Beam | structural bar (a "2×4") | box |
| Panel / Sheet | wide flat sheet | box |
| Block | chunky solid | box |
| Ball | sphere | sphere |

**FASTENERS / JOINS** (connect) → constraint:
| Name | Real-world behavior | Constraint |
|---|---|---|
| Weld | permanent, rigid, strongest | fixed |
| Glue | permanent, rigid | fixed |
| Bolt | rigid, removable | fixed |
| Nail / Screw | rigid fastened | fixed |
| Hinge | pivots on one axis | revolute |
| Axle / Wheel | spins free or powered | revolute (+motor) |
| Slide / Rail | slides along one axis | prismatic |
| Pin / Pivot | pivots freely | ball |
| Rope / Cable | flexible tie | rope |
| Anchor | fastened to the ground | anchor-to-world |

**Forward-compatibility note:** Several fasteners (weld/glue/bolt/nail) are *identical rigid behavior in v1* and differ only in name/icon. They are shipped as **distinct entries from day one** because they will diverge in **strength / resistance to flexing & ripping** once the failure/FEA evaluator arrives. The realistic naming is intentional setup for that.

### 6c. Materials — referenced table
Materials live in **one named table** in the document; each piece references a material by name (like a paint palette), so editing "steel" updates every steel piece and files stay light.
- v1 fields used by rigid-body sim: `density` (→ realistic mass), `friction`, `restitution` (bounciness), `color`.
- **Reserved-now, unused-in-v1 engineering fields** (so the FEA evaluator needs no migration later): `youngsModulus` / elastic modulus, `yieldStrength`, `poissonRatio`.
- Ships with sensible presets (e.g. steel, aluminum, wood, plastic, rubber). Users can **edit presets and create new materials**.

### 6d. Document shape
```
{
  version,
  metadata,
  materials[],          // named table (6c)
  pieces[],             // stock instances: { id, name, stockType, dimensions, material, definition.transform, state.transform, anchored }
  fasteners[],          // first-class connections: { id, type, partA, partB|world, params (axis, restLength, motor...), state (angle/config) }
  ground,               // floor + gravity vector
  camera
}
```
- **Fasteners are first-class objects** (not nested inside pieces) because a fastener relates *two* pieces and owns its own state (angle/config) — this keeps mechanisms (M3) clean.

---

## 7. UI & Interaction Layout

Standard tool shell:
- **Top toolbar:** ▶ Running / ⏸ Pause / ↺ Reset · Undo / Redo · Save / Open / Export (glTF, STL).
- **Left palette:** *Stock* group (Rod, Tube, Slat, Joist, Panel, Block, Ball…) and *Fasteners* group (Weld, Glue, Bolt, Nail, Hinge, Axle/Wheel, Slide, Pin, Rope, Anchor). Pick a tool, click/drag into the scene.
- **Center viewport:** live 3D world — orbit/pan/zoom, click-to-select, drag-to-place (held-piece model §3), ground grid, gravity, shadows.
- **Right panel:** *Properties* of selection (dimensions, material dropdown, **Anchored** toggle, transform) and a *Materials* editor (edit presets / **+ new material**).
- **Status bar:** piece/fastener counts, pause state, fps.

Possible later additions (not committed for v1): scene-tree list of all pieces, bottom timeline.

---

## 8. Data Flow & Persistence

### One-way data flow
```
User action (place / fasten / edit / pause)
  → mutate Document Definition (+ history for undo/redo)
  → Physics integration layer reflects change into the Jolt world
  → Jolt steps each frame, writes transforms into Document State
  → Three.js renders State; UI panels read Document
```
Document is always authoritative; Jolt writes **only** the State half back. Undo/redo operate on Definition (structural changes), not on every physics frame.

### Save / load / export
- **Canonical format `.neocad.json`** — plain JSON, round-trips **everything** (stock, fasteners, motors, anchoring, materials, definition + state). Used by Save/Open. This is also the **share mechanism** (send the file; no backend).
- **glTF export** (one-way) — current posed geometry + visual materials, via Three.js `GLTFExporter`. For Blender/web viewers/visual sharing. Drops buildability semantics.
- **STL export** (one-way) — geometry only, for slicers / 3D printing. Serves the build-focused audience.
- **Local autosave** — current document persists to browser **IndexedDB** so refresh doesn't lose work.
- **Versioning** — every file carries `version`; a small migration step lets older files load as the schema grows (matters once FEA fields / parts-kit arrive).

**Out of v1:** STEP export (needs a B-rep kernel; doesn't fit primitive geometry yet); glTF physics extensions (too immature to carry joint data reliably).

---

## 9. Testing Strategy

The bespoke physics-integration layer is the riskiest code, so tests center there.

- **Document model — pure unit tests:** create/edit/fasten operations, undo/redo, **save→load round-trip** (serialize then deserialize equals original), version migration. Fast, no physics.
- **Physics integration layer — deterministic scenario tests:** compile a known document → step Jolt a fixed number of times → assert outcomes within tolerance. Encodes the milestone behaviors as regressions:
  - a dropped block lands and rests on the ground;
  - an anchored beam does not move;
  - a hinge swings; a motor spins a wheel;
  - a rope holds a weight.
- **Catalog mapping tests:** every stock item maps to a valid primitive; every fastener maps to a valid constraint; no orphan references.
- **Thin UI/interaction tests:** held-piece-is-inert until release; place→commit creates a dynamic body; pause freezes stepping.
- **Manual verification per milestone:** actually build the wow demo in the running app and watch it behave (M1 stack, M2 standing table, M3 pulley) — per the project's "verify before reporting fixed" rule.

---

## 10. Milestones (Stage 1 internal sequence)

The three "wow" moments, in natural build order:

- **M1 — Playful rapid building.** Place stock from the palette, held-piece placement, live collision/gravity, stacking, pause/resume, basic materials, autosave. *Proves the nimble UX feel.*
- **M2 — Stable structures that hold.** Anchoring/grounding, rigid fasteners (weld/glue/bolt/nail), a structure that stands under gravity and a bad one that visibly topples. Save/load + export. *Proves grounding/stability/viability.*
- **M3 — Working mechanisms.** Hinges, sliders, ball pivots, ropes, **motors** (powered axle/wheel). A pulley lifting a weight; a driven cart. *Proves dynamics + mechanisms.*

---

## 11. Explicitly Deferred (not Stage 1)

- AI / natural-language design / suggestions (all of Stage 2).
- Static stability verdicts, FEA stress/failure, soft-body deformation (future evaluators).
- Parts kit beyond primitive-backed stock; STEP export; accounts/cloud save/galleries.
- Distinct fastener *strengths* (names ship now, strengths come with the failure evaluator).

---

## 12. Details To Resolve During Planning

These do not change the spec's intent but must be pinned down in the implementation plan:

- **Rope state serialization (§6d, §9):** define concretely what a rope/cable's `state` serializes as (e.g. list of node positions, or rest length + endpoints) so save→load round-trip and the "rope holds a weight" scenario test have a defined assertion target.
- **Held-piece snapping (§3):** specify grid resolution, snap tolerance, and whether snapping is toggleable.
- **Document lifecycle (§7, §8):** define the New / Open / autosave-restore flow — how the single IndexedDB autosaved working document interacts with explicit Save/Open of named `.neocad.json` files (overwrite on load? clear/new? restore prompt on launch?).
- **Determinism (§1, §4, §9):** confirm the **fixed-timestep** Jolt configuration required for the deterministic scenario tests to hold.
