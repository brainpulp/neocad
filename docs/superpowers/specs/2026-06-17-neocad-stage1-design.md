# NeoCad — Stage 1 Design Spec

**Date:** 2026-06-17 (amended 2026-06-18)
**Status:** Approved for planning
**Scope:** Stage 1 only (the physics-aware builder's sandbox). Stage 2 (AI-assisted design — full natural-language → manufacturable design) remains deferred to its own future spec. **Amendment (2026-06-18):** Stage 1 now includes a *guidance* layer — see §1a and §13. This is a deliberate change from the original "no AI in Stage 1" stance.

---

## 1. Vision & Framing

NeoCad aims to let anyone with a hardware idea model it directly — collapsing the distance between hardware design and visual art, and removing the need for CAD-expert intermediaries. The full vision is a two-stage system:

- **Stage 1 — Physics-aware builder's sandbox (this spec).** A web app where makers assemble real-world stock (rods, joists, panels) using real-world fasteners (welds, bolts, hinges, axles, ropes) and watch it behave under live rigid-body physics. Deterministic, testable, shippable on its own.
- **Stage 2 — AI-assisted design (future, separate spec).** Natural language → manufacturable designs, validated against the same physical constraint framework Stage 1 establishes.

Stage 1 is explicitly the **test bed** for Stage 2. It must be compelling on its own merits — but compelling now requires being *usable by a non-expert on first contact*, which is why guidance (§1a) is in scope.

### Target audience (first)
People who **intend to build** — makers, tinkerers, DIY/woodworkers, fabricators. This drives a core product decision: the user-facing vocabulary mimics the real world (stock and fasteners), never abstract geometry or physics jargon.

### 1a. Positioning & the usability mandate

NeoCad is a **"Tinkercad Sim Lab for builders."** The reference point is also the cautionary tale: Tinkercad's sim lab, though built for children, is *not* easy to use — a user with decades of mastery across every major CAD/3D app got stuck within five minutes, at the moment of **fastening table legs to a tabletop**. The failure was discoverability: it was not obvious *how to connect two things*.

This sets a hard product mandate for Stage 1: **a first-time builder must be able to make their first real thing without instruction.** We pursue this on two fronts, in priority order:

1. **Affordances first (the primary fix).** Connecting two pieces must be intrinsically discoverable — no palette hunt. When a piece is dragged so it meets another (e.g. a leg's end against a tabletop), the app *offers the join in place*. If the only way to make fastening usable were an AI pointing at a button, the button would be in the wrong place. Good affordance means you rarely need to be told.
2. **Ambient guidance second (the backstop).** For what affordances can't cover — intent the app can't infer, or a user who is simply stuck — a quiet "experienced teacher" watches the current state and offers *one contextual nudge at a time*, pointing at the right next action. It never takes over. (Full spec: §13.)

The guiding image: **a child with an experienced teacher beside her, pointing at the right button when she'd otherwise be lost.** Anyone — expert or novice — should be carried past the moment of being stuck.

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

**~~No AI, no suggestions, no rule-based hints in Stage 1 — pure deterministic playground.~~** *(Superseded by the 2026-06-18 amendment.)* The **physics engine** remains a pure deterministic playground — the guidance layer (§13) sits *outside* the simulation. The AI/teacher writes to the document exactly as a user would (place pieces, add fasteners); it never perturbs the physics step, never injects nondeterminism into the sim, and the deterministic scenario tests (§9) are unaffected. Determinism is a property of the evaluator; guidance is a property of the editor.

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

- **Full Stage 2 AI** — freeform natural-language → manufacturable design, the LLM emitting arbitrary geometry, and design *suggestions/critique*. (Stage 1's guidance layer, §13, is deliberately narrower: discoverability nudges + recipe-filling, not open-ended generation.)
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
- **LLM backend / key (§13):** decide bring-your-own-key vs. a thin serverless proxy (see §13.5) — this is the one open item that touches the "static site, no backend" constraint and must be settled before the LLM tier is built.
- **Recipe schema (§13.4):** define the parametric-recipe format the LLM fills (parameters, defaults, validation) so "make me a table" maps to a bounded, testable operation rather than freeform geometry.

---

## 13. Guidance Layer (Stage 1) — Affordances + Ambient Teacher

The usability mandate (§1a) is met by three concentric rings, from cheapest/most-deterministic outward to most-capable. Each ring only handles what the ring inside it couldn't.

### 13.1 Ring 1 — Discoverability affordances (primary, no AI)
Pure interaction design, no model calls, fully deterministic. The single most important one:

- **Proximity fastening.** When a held/dragged piece's connectable feature meets another piece's surface (within snap tolerance, §3), the app surfaces an **in-place join offer** at the contact point — a small inline control to fasten *right there*, defaulting to the most likely join (e.g. Weld for a leg-to-top contact). No trip to the left palette. This directly dissolves the Tinkercad "how do I attach the legs?" wall.
- Contextual cursors/highlights showing what a click will connect to; clear selected/connectable states.

These ship as ordinary UX and are testable as thin interaction tests (§9). They are the **first** thing M2 must nail, since M2 is where fastening arrives.

### 13.2 Ring 2 — Rule-based nudges (the teacher's reflexes)
Cheap, instant, offline, deterministic. A small rules engine reads document state (counts, selection, what's fastened, current milestone intent) and surfaces **one nudge at a time**, pointing at the right next action — e.g. *"You've placed 4 legs and a top but nothing's joined — click Weld, then click a leg."* Dismissable; can be toggled off entirely by experienced users. No network. Cannot infer novel intent — only recognizes known patterns.

### 13.3 Ring 3 — LLM intent layer (the teacher's understanding)
Engages when rules can't resolve the situation, or the user explicitly asks. **Entry point:** the opening moment is *"What do you want to make today?"* (alongside a gallery of starters and a "just start building" escape hatch, so the prompt is never a blank-page wall). Interaction loop is strictly:

> **propose → confirm → execute → adjust.**

The LLM **never silently executes.** It clarifies and offers: *"Are you trying to make a roof? Tell me a bit more and I'll build a first version — then you can adjust it, or take over yourself."* On confirmation it writes pieces/fasteners into the document (exactly as a user would; §4 amendment), then hands control back for hand-editing.

### 13.4 Scope guard — recipes, not freeform geometry
Freely emitting valid geometry from natural language *is* the hard part of Stage 2 and is **out of Stage 1**. In Stage 1 the LLM is constrained to **select and fill parametric recipes/templates** (e.g. `table{legs:N, topW, topL, height}`), not arbitrary geometry. This keeps generation bounded, roughly deterministic, and testable, while still delivering the "here's a first version, now adjust" moment. The recipe library grows over time; freeform generation is the Stage 2 graduation.

### 13.5 Architectural consequence — the backend tension
Rings 1–2 are free and offline and preserve the "static site, no backend, no accounts" stance. **Ring 3 requires an LLM call**, which the original static-site constraint forecloses. This must be resolved (see §12): either **bring-your-own-key** (user supplies an API key, stays backend-less) or a **thin serverless proxy** (a single function, not a full backend/accounts system). Whichever is chosen, Rings 1–2 must remain fully functional with no key and no network, so the core builder never depends on AI availability.

### 13.6 Relationship to Stage 2
This layer is *guidance for hand-building*, not *design automation*. Stage 2 remains the deeper system: freeform NL → manufacturable design with critique and constraint-validation. §13 is the on-ramp that makes Stage 1 usable; Stage 2 is the destination.
