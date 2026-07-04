# NeoCad

Web-based, physics-aware hardware design sandbox. Lets anyone model hardware ideas by
assembling real-world stock (rods, joists, panels) with real-world fasteners
(welds, bolts, hinges, axles, ropes) and watching it behave under live physics.
Audience (first): makers/tinkerers who intend to build. UI uses real-world vocabulary,
never abstract geometry/physics jargon.

## Picking up on another device

1. `git clone https://github.com/brainpulp/neocad.git && cd neocad`
2. `npm install`
3. Tell Claude: **"Read CLAUDE.md and pick up where we left off."**

## ⚠️ Branch `m-transform` is SUPERSEDED — do not resume it

The builder-UX milestone (below) re-implemented m-transform's goals directly on `main`
with a different design (drag-first + pause-gizmo instead of always-on PivotControls).
The `m-transform` branch remains only as reference; delete it when convenient.

## Two-stage vision

- **Stage 1 (in progress):** physics-aware builder's sandbox. Rigid-body only.
  Ambient physics with pause-to-model. Document = source of truth; physics = a
  disposable, pluggable *evaluation* of it (soft-body/FEA are future evaluators).
- **Stage 2 (deferred, own spec):** AI-assisted natural-language → manufacturable
  design, validated against Stage 1's constraint framework.

Spec: `docs/superpowers/specs/2026-06-17-neocad-stage1-design.md`
Plans: `docs/superpowers/plans/` · Backlog: `docs/BACKLOG.md`

## Status

- **M-JointContact (surface-contact joining — the literal-joints slice) — DONE &
  browser-verified.** THE MODEL (converged with user, spec:
  `docs/superpowers/specs/2026-07-04-joints-literal-redesign.md` — read it before
  ANY joint work): joining only BONDS; motion comes from HARDWARE (generic
  hinge/bearing/slide parts, next milestone, Opus batch) or SHAPE (drilling,
  later). THE SLICE: planJoint rewritten around SURFACE CONTACT — new
  `document/contact.ts` has `surfaceAnchor` (nearest surface point + outward
  normal per primitive) and a GJK boolean overlap test (support functions,
  3 mm erosion margin so kiss-contact ≠ overlap). Landing = mover's clicked
  surface normal opposed to stationary's, twist-snapped, clicked points kiss —
  a dowel clicked onto a log's flank lands TANGENT on the barrel (was: buried
  co-axially, the "trying to fix a dowel to a cylinder" screenshot). MOVER RULE:
  second-clicked comes to the first; anchored never moves; both fixed → veto.
  COLLISION VETO: landing that would interpenetrate ANY piece is refused
  ("Solving this joint would create a collision"), `.joint-notice` toast in App.
  Exemption: bore-meets-cylinder-shaft pairs (gear onto axle) stay co-axial and
  unvetoed — mechanical stock collides as solid cylinders until drilling.
  PAUSE-TO-JOIN: selecting the joint tool pauses (stays paused). WYSIWYG picker:
  suggestions only update the DISPLAYED type at first click; displayed = applied
  (old code silently substituted a suggestion at second click after tool
  re-entry — the radio lied). Edge+pivot/cylindrical: lands flush via contact,
  but the motion axis is the clicked EDGE line projected into the contact plane
  (door swings on its edge, not the face normal). Slide stops now measured on
  the stationary guide. Drop-attach (resolveJoin) reordered: target stays,
  dropped piece moves. 170 tests. NEXT: Opus batch per the spec — on-canvas
  adjust handles, generic hardware trio, weld-chain compiler collapse.
- **M-JointEdit (Onshape-style joint adjust — actually moves the part) — DONE & browser-verified.**
  ROOT INSIGHT from researching Onshape mates: a mate isn't baked once — it has
  live offset/angle params that RE-SOLVE and MOVE the parts, plus a flip that
  flips the part to the other side. NeoCad baked alignment at creation and never
  re-applied it, so "Flip axis" only reversed the stored axis vector (motor
  direction) and did nothing visible — the #1 "no way to modify the angle"
  complaint. NEW: `adjustJoint(id,{rotate,slide})` rigidly turns/slides the LOOSE
  piece about/along the world joint axis through the anchor (jointFrame +
  rotatePieceAboutAxis/slidePieceAlongAxis in joints.ts), committed via
  movePieceTransform (one undo, clamps slab). Inspector ADJUST row: ↺−15° /
  ↻+15° / ⟲Flip(180°) / ←Slide→, labeled with which piece moves (the loose/
  smaller one, matching the joint mover rule). Old Flip-axis/Swap-ends kept for
  motion-direction. GHOST-DUPE: dumped the full render tree during place + pull-
  drag — exactly ONE solid mesh + ONE inverted-hull outline per selected piece,
  NO duplicate geometry. The "ghosts" are drop-shadows of lifted pieces or two
  genuinely-overlapping solids (bad joint / stacked placement), not a render
  bug. CLIP-TO-STAGE (the real "its clipping to stage" bug): clampAboveSlab's
  on-slab test used the piece CENTRE, so a wide piece whose centre sits just
  past the bench edge got clamped to the GROUND (y=0) while its body overhung
  back onto the raised slab — sinking the overhang into the stage. Now the
  floor is the slab top whenever the piece's FOOTPRINT (|x|−hx, |z|−hz) overlaps
  the bench, ground only when fully clear; physics still tips a real overhang
  off on Run. NEXT: gear/rack/screw couplings; the A→type→B joining GESTURE
  stays a Fable task.
- **M-JointFix2 (mover-by-size, huge-label bug, collapsible SCENE) — DONE & browser-verified.**
  BAD-JOINT ROOT CAUSE: with both pieces free planJoint moved the FIRST-clicked
  one, so clicking a big cylinder first ROTATED+SLID the whole cylinder onto a
  thin dowel (the clipping screenshot). Now both-free → the SMALLER piece
  (pieceVolume) moves; anchored still wins. GIANT "End" LABEL: FeatureMarker/
  HeldPiece/JointEditor Html used drei `distanceFactor` → balloons to fill the
  screen when the camera is close; removed it (fixed screen size like the
  weight chip). SCENE tree is now a collapsible `<details>` card (SCENE · N)
  with its own border/background so it stops blending into the inspector.
- **M-JointAlign (flush face-mate fix + flat 2D joint symbols) — DONE & browser-verified.**
  THE BIG JOINT BUG: joining two faces clipped instead of mating flush. Root
  cause in features.ts — a box face's `axis` was the unsigned axis LINE
  ([1,0,0] for BOTH the +x and −x faces), so planJoint could not tell which way
  a face pointed. Faces now carry their true OUTWARD normal (−x face → [−1,0,0];
  wedge bottom → [0,−1,0]). planJoint then separates ENGAGEMENT into two rules:
  two faces mate ANTI-parallel (normals opposed → flush kiss, `faceMate` branch);
  everything else (shaft→bore, peg→face, edge→edge) stays PARALLEL/co-axial as
  before. `jointAxis` (stored motion axis) is now computed separately from the
  alignment target. planJoint's `type` widened JointType→FastenerType so welds
  can align too. Tests: face-mate flush + opposed normals; co-axial dowel-in-bore
  unchanged. Browser-verified: two rotated boards hinge flush (survive Run);
  a 45°-tilted dowel joints co-axial/vertical into a block (was the clipping
  screenshot). GLYPHS are now FLAT 2D symbols in 3D planes (not chunky 3D):
  ring-arc hinge, double-arrow slider, twin-ring axle lie in the joint-axis
  plane; weld disc / bolt hex / nail / glue / spring billboard to camera.
  meshBasicMaterial, DoubleSide, depthTest off (x-ray), toneMapped off.
  STILL OPEN (Fable session): the A→type→B joining GESTURE itself (make it
  "easy and concrete", motion-preview ghost before commit). NEXT Opus batch:
  gear/rack/screw couplings (Jolt GearConstraint/RackAndPinionConstraint verified
  exported) → then rebuild mechanisms.
- **M-JointIdentity (maker renames + per-type 3D glyphs) — DONE & browser-verified.**
  Labels now speak hardware (schema ids unchanged): Pivot→**Hinge**,
  Cylindrical→**Axle**, Linear→**Slider**. FastenerMarker.tsx renders a distinct
  screen-scaled 3D glyph per type, aligned per-frame to the live joint axis:
  hinge = swing ARC whose sweep mirrors angleMin/Max + axis pin; slider =
  travel arrow with end-stop ticks; axle = translucent bearing sleeve + spin
  ring; weld = bead disc; bolt = hex head; nail = pin; glue = droplet; spring =
  coil tether (world-space sibling mesh). Color language: orange = rigid bond,
  blue = motion, green = elastic; selected = hot orange. Rigid badges X-RAY
  (depthTest off) because they sit exactly at the mating interface and would
  be buried between flush faces; motion glyphs stay depth-tested. Glyphs are
  the click target for the joint inspector. NEXT (agreed in discussion, see
  chat + this order): (1) gear/rack/screw COUPLINGS between existing joints —
  Jolt's GearConstraint + RackAndPinionConstraint ARE exported by this binding
  (verified at runtime); a coupling references two fastener ids + ratio;
  (2) ball joint (SwingTwistConstraint, also exported); (3) pin-slot joint;
  (4) mechanism library craft rebuild on top (real gear train, screw jack).
  The JOINING-FLOW redesign (make A→type→B "easy and concrete", motion
  preview ghosts before commit) is reserved for a Fable session per user.
  DESIGN DOCTRINE from the joint discussion: joints must pass the "can a
  maker point at the hardware?" test — Onshape's planar/parallel/tangent/
  width mates are constraint-solver substitutes for physics and are
  deliberately OMITTED (NeoCad's live physics already does their job).
- **M-Placement (context-aware placement, de-anchored mechanisms, rope elasticity)
  — DONE & browser-verified.** STOCK GHOST now rests ON the surface under the
  cursor (rest height = floor + half-height-down, floor = slabTop on the bench
  else 0) — WYSIWYG, no more 1.2 m sky-drop that stacked/clipped pieces onto
  each other (the apparent "ghost duplicates" were two real overlapping pieces
  from that drop, NOT a render bug — verified: exactly one solid mesh + one
  outline per piece). MECHANISMS are placed via a MODE, not inserted at origin:
  palette click → `placingMechanismId` + footprint ghost follows cursor →
  ground click → `placeMechanismAt(pos)` (Esc cancels). NO MECHANISM IS
  ANCHORED anymore (user-only Fix): every one is welded to a heavy concrete
  BASE PLATE that just rests on the bench (`basePlate()` + `weld()` helpers in
  mechanisms.ts); posts/stands/rails weld to it. `mechanismBounds()` sizes the
  ghost. Test asserts no mechanism piece is `anchored` and each is one connected
  assembly (catapult payload is the one allowed loose projectile). SWING GATE
  rebuilt to read as a gate: two posts (hinge/latch) + a leaf hinged between
  them with swing limits. ROPE ELASTICITY: new `Rope.elasticity` (0 = an
  inextensible real rope, default; higher = bungee) drives edge compliance;
  soft-body mLinearDamping + 12 iterations kill the old wiggle. Inspector's
  "Stiffness" row is now "Springiness" (shows "rope" at 0, "bungee N%" above).
- **M-Stability (bug batch: silent disintegration, teleports, dead audio) — DONE
  & browser-verified.** IMPACT SOUNDS NEVER WORKED before this: Jolt's
  OnContactAdded fires AFTER the solver kills the closing velocity, so live
  GetLinearVelocity reads ~0 for every hit and nothing crossed the loudness
  threshold — fix: capture per-body velocities BEFORE each step (preStepVel
  map) and compute approach speed from those. Regression test asserts a
  dropped block reports >2 m/s. PULL is now a SOFT tether (DistanceConstraint
  min=max=0 + spring 4.5 Hz/damping 1, not a rigid PointConstraint): rigid
  pulls generated unbounded force when the towed piece jammed against the
  bench — enough to silently rip fasteners apart ("parts keep disappearing").
  BREAKABLES need SUSTAINED overload (6 consecutive over-strength steps, or
  3× strength once) — single solver spikes on deep contacts must not
  disintegrate builds. clampAboveSlab now clamps ONLY the edited pieces
  (whole-doc sweeps popped bystanders resting half off the bench edge on
  every unrelated commit; sandbox resize still sweeps all). endPull clamps
  exit SPIN (≤6 rad/s) and spinPull is capped ±8 rad/s (pinwheel-roll-away).
  insertMechanism shifts new mechanisms +x clear of existing pieces (spawning
  into a build exploded it). Dev hook `window.__audio` = {stats, state()}.
- **M-Interaction (pull-drag, rotate ring, multi-select, breakable bonds) — DONE
  & browser-verified.** PULL-DRAG is the default running drag: a Jolt
  PointConstraint "mouse joint" — kinematic sensor HAND body (mIsSensor, silent
  in the contact listener) point-constrained at the clicked spot; pieces dangle/
  pivot under their weight; mass felt via tow-speed cap (60/mass, ≤4 m/s) +
  angular damping 1.5 during the pull; Ctrl/Cmd = old rigid kinematic carry.
  GOTCHA: hand-rolled point-impulse grabs are UNSTABLE at long lever arms (limit
  cycle at the ±25 rad/s cap — looks frozen under aliased sampling); also
  emscripten's GetInverseInertiaDiagonal lives in the inertia PRINCIPAL frame
  (GetInertiaRotation), not body frame. ROTATE RING (RotateRing.tsx): paused +
  selected + HOLD ALT → one ring for the current axis; X/Y/Z switch axis; drags
  snap to 15° (Shift = free); jointed pieces get the ring on their JOINT axis
  and swing about the anchor (no-rotation joints show no ring). Ctrl-drag
  paused = move whole fastened ASSEMBLY rigidly (connectedGroup BFS, one undo
  via transient API; frame loop must skip group members during the drag).
  MULTI-SELECT: selectedIds[] (selectedId = primary), Shift-click toggles,
  Shift+drag on empty ground = marquee (catcher plane mounts only while Shift
  held so click-deselect/orbit survive; store.marquee rect + App overlay div);
  drag on a selected piece moves the whole selection; Delete removes all.
  COACH TIPS (CoachMarks.tsx): first-use cards (pull/joint/rope/blower/paused-
  edit/multi-select), "Got it" per tip + "don't show tips again", localStorage.
  BREAKABLE RIGID FASTENERS: strength (N) per type (weld 9000 / bolt 6000 /
  nail 2000 / glue 1200, per-fastener override in inspector, shown as "holds
  ~X kg"); compiled as all-axes-fixed SixDOFConstraint because THIS BINDING
  ONLY EXPOSES GetTotalLambdaPosition ON SixDOF (Jolt.FixedConstraint is not
  exported); |lambda|/dt > strength → RemoveConstraint + onBreak → store.
  breakFastener (NO undo entry — a physics event; doc change re-keys the world).
  MECHANISMS: four-bar linkage (Grashof crank–rocker, motorized), catapult
  (counterweight + angle-limited pivot + loose payload), rope swing (2 soft-body
  ropes; MechanismBuild.ropes[] now supported by insertMechanism).
- **M-Quality1 (bug-fix batch from user critique) — DONE & browser-verified.**
  ROTATION ARCS REMOVED entirely (user: "lose them completely") — rotation is
  Alt-drag for now; a better single-axis UX is under discussion, do NOT rebuild
  gizmos without agreement. WEDGE stock (ConvexHull physics, custom prism
  geometry in `render/mechanical.ts` `wedgeGeometry`, slope/apex features).
  Selection outline is SCREEN-CONSTANT (~2px via per-frame camera-distance rim
  in PieceMesh useFrame) — balls and dowels read the same. WEIGHT display:
  `pieceMass`/`formatMass` (catalog.ts), inspector row + floating chip on the
  selected piece. BLOWER tool (🌬): hold LMB while running → force cone along
  the cursor ray (`applyBlower`, gentle 1/(1+0.02t²) falloff because the nozzle
  is the camera 4–8 m out), strength slider in EnvPanel, faint cone visual.
  DEPENETRATION: `clampAboveSlab` sweeps pieces out of the workbench slab on
  movePieceTransform + endTransient commits (resize-into-stage bug). FLUSH
  TWIST-SNAP in planJoint: after primary axis alignment the mover's roll about
  the joint axis snaps to the stationary piece's nearest projected axis (≤45°)
  so edge joints engage parallel. ALL fastener types (weld/glue/…) selectable
  from tree + markers, not just joints. Joint inspector: pivot swing limits
  (degrees→Jolt hinge mLimits), cylindrical canSpin/canSlide toggles (remap to
  hinge/slider/fixed at compile). Contact hardening: Baumgarte 0.18 + per-joint
  velocity/position iteration overrides. Audio: ensureAudio returns the
  resume() promise (playBeep awaits it — the old sync check raced and silently
  no-oped), arming also on keydown (spacebar slingshot can be the first
  gesture). Shadow gap fixed: 4096 map + ±5 m shadow frustum + normalBias.
- **M1 (playful building) — DONE & verified.** Place stock from a palette into a live
  Jolt world, held-piece placement (inert until released), play/pause/reset, materials,
  IndexedDB autosave + file save/open. See `docs/superpowers/plans/M1-verification-notes.md`.
- **M2 (stable structures) — DONE & verified.** Rigid fasteners (weld/glue/bolt/nail) →
  Jolt fixed constraints; **proximity fastening** (Ring 1 affordance — click a piece onto
  another to auto-weld, no palette hunt); selection + editable Properties; materials editor;
  fastener markers; glTF/STL export. See `docs/superpowers/plans/M2-verification-notes.md`.
- **M2.5 (builder UX quick wins) — DONE & verified.** Delete pieces/fasteners, scene tree
  (select + delete), keyboard shortcuts (Delete/Esc/Ctrl+Z/Y), empty-state hint, fastener
  count in status bar. See `docs/superpowers/plans/M2.5-verification-notes.md`.
- **M-Ropes (soft bodies, stage 1) — DONE & browser-verified.** Ropes are Jolt SOFT
  BODIES (particle chain + edge constraints, skip-one edges resist kinks) — the first
  non-rigid element. `Document.ropes[]` stores rest params only (length/slack/
  stiffness/segments/radius/looped/attachments); live particle state is evaluation
  state, never persisted. 🪢 Rope tool: click end A → end B (clicking a piece TIES
  the rope there, piece-local anchor). Pinned ends follow their pieces kinematically;
  Jolt pins are one-way, so `updateRopeAttachments` mirrors end-edge strain as force
  onto dynamic pieces — a rope genuinely HOLDS a hanging weight (unit-tested).
  GOTCHA: soft-body vertex positions are RELATIVE to the body's drifting origin —
  always add `body.GetPosition()`. Looped ropes = flat two-strand belts (pulley-ready).
  Render: per-segment cylinder chain driven imperatively. Inspector: thickness/slack/
  stiffness/segments/looped/delete; scene-tree rows. `hemp` material added.
- **M-BuilderUX5 (motors, springs, mechanisms, materials) — DONE & browser-verified.**
  FIXED the "joints act like springs" bug: the frame loop no longer steps/syncs a
  STALE physics world (build-key gate in Scene.tsx) — align-on-create now sticks while
  running. Fastened pairs only skip contact when their shapes overlap at the join
  (doors can't clip through posts). MOTORS on pivot (rad/s + torque) and linear (m/s +
  force) joints via the joint inspector; SPRING joint type (Jolt DistanceConstraint,
  stiffness Hz/damping/rest length, wireframe tether visual); MECHANISMS palette
  (see-saw, pendulum, swing gate, motorized crank-slider — plain pieces, fully
  editable; crank-slider reciprocation is unit-tested). 30-material library with
  honest densities (woods/rubbers/plastics/metals/minerals/ice), texture by family.
  Env: hurricane mode (×6), drifting wind-direction arrows, camera quake-judder +
  wind sway, rocks aim at the CURSOR with 10 jittered tumbling shapes. Sound: audio
  re-arms on every gesture + 🔊 beep confirmation; dev `window.__impactCount`.
  Alt-duplicate is paused-only. Palette: emoji icons + collapsible sections.
- **M-BuilderUX4 (modifiers, forces, arcs, inspector) — DONE & browser-verified.**
  Alt BEFORE click = drag a duplicate (drag survives the world rebuild); Alt DURING
  drag = rotate in place (+Shift tilts about camera-right); dimension EXTENSION LINES
  with end ticks during resize; joint tool reverts to Move after each joint; recovery
  ladder (Put back / 🧹 Tidy / Adopt pose); wind (tips structures — pushes above the
  midline), earthquake, spacebar slingshot (rocks on LAYER_PROJECTILE fly over the
  sandbox walls; walls still contain pieces); velocity caps + softer Baumgarte;
  TransformControls REPLACED by custom per-axis rotation arcs (RotateArcs.tsx) that
  live on the bounding-box shell with the resize handles — no more gizmo fights;
  joint inspector (flip axis / swap ends / numeric limits); procedural material
  textures (render/textures.ts, canvas-generated, color multiplies through).
- **M-BuilderUX3 (direct-manipulation polish) — DONE & browser-verified.** Corner resize
  handles anchor the OPPOSITE corner (Tinkercad-style) with live cm dimension bubbles;
  a lift cone raises/lowers pieces; rotate rings are always on while paused (no gizmo
  modes); paused body-drag moves pieces — jointed pieces move ALONG their joint only
  (slide within end stops / swing around the pivot axis) so users align motion after
  joining; Shift while dragging lifts vertically; thin selection outline; view cube
  (drei GizmoViewcube); zoom-extents (⛶ Fit, window event `neocad:fit`); linear joints
  slide IN the mated face plane (not along the normal) and a JointEditor widget (select
  a joint marker / tree row while paused) drags end-stop limits and re-aims the axis
  on screen; sandbox workbench slab (Document.ground.sandbox, size slider when nothing
  selected) with invisible walls so physics can't fling pieces away; capped drag speed
  + clamped throw velocity; "Fix" affordance (pin in tree, F key); material/strength-
  aware procedural impact sounds (WebAudio + Jolt ContactListenerJS, 🔊 toggle);
  undo/redo bump worldEpoch so restored poses actually apply.
- **M-BuilderUX2 (feature joints, resize handles, slider inspector) — DONE & browser-verified.**
  Joints snap to part FEATURES (bore/centerline/ends/edges/face centers — see
  `document/features.ts`), suggest their type from the pairing (bore→cylindrical,
  edge→pivot, face+face→linear), and ALIGN the loose piece so anchors coincide before
  constraining (`document/joints.ts` planJoint — no yank on Run). Linear/cylindrical
  joints get slide END STOPS from the guide piece's extent (a gear can't fall off its
  axle). Fastened pairs don't contact-collide (Jolt GroupFilterTable). Tinkercad-style
  white resize handles (base corners = plan resize, top = height, base-fixed) live
  alongside the Move/Rotate gizmo when paused; whole-gesture = one undo (transient API).
  Inspector uses labeled cm sliders (Length/Width/Height/Radius/Thickness/Teeth).
  Dev-only `window.__neocadStore` + `window.__camera` power Playwright e2e checks.
- **M-BuilderUX (drag, gizmo, joints, mechanical stock) — DONE, needs hands-on feel pass.**
  Tinkercad-style presentation (white bg, soft hemisphere+key lighting, light grid, orbit
  clamped above ground); selection = orange inverted-hull outline (shading untouched);
  default tool drags pieces across the canvas while the sim runs (kinematic grab, throwable)
  and becomes a move/rotate/scale TransformControls gizmo when paused; dropping stock onto a
  piece opens an attach dialog (weld/glue/bolt/nail, pivot/cylindrical/linear, or none —
  physics pauses while it's open); Joint tool places point A → type → point B joints
  (pivot=hinge, linear=slider, cylindrical=6-DOF) with piece-local anchors; mechanical
  stock (gear/pinion/ratchet/cam/pulley/axle/pin) with real silhouettes, cylinder collision.
- **Guidance Rings 2 & 3 — NOT STARTED.** Spec §13 amendment added a guidance layer; M2
  shipped Ring 1 (proximity) only. Ring 2 (rule-based nudges) then Ring 3 (LLM "what do you
  want to make?", needs the §12 backend-key decision) are a later **Guidance milestone**.
- **M3 (mechanisms) — PARTIALLY LANDED via M-BuilderUX.** Hinge/slider/cylindrical shipped
  as joints. Remaining: ball/rope fasteners, motors (axle/wheel), gear-mesh physics,
  pulley + driven-cart demos, incremental physics-world updates.

## Tech stack

Vite + React + TypeScript · Three.js + @react-three/fiber + @react-three/drei ·
Jolt physics **used directly** via `jolt-physics` (`JoltPhysics.js`), NOT the alpha
`react-three-jolt` wrapper · Zustand (document store) · Vitest + Testing Library ·
static build → GitHub Pages.

## Architecture (key files)

- `src/document/` — the source-of-truth document (`math.ts` = three-free vec/quat helpers).
  - `types.ts` — Document (Definition + State), Piece, Material, Ground.
  - `catalog.ts` — real-world STOCK → engine primitive mapping + `makePiece`.
  - `document.ts` / `store.ts` — pure ops + Zustand store (undo/redo, activeTool, running, reset).
  - `serialize.ts` — `.neocad.json` round-trip + version migration.
- `src/physics/` — **bespoke integration layer (the riskiest code).**
  - `jolt.ts` — WASM init + collision-layer boilerplate.
  - `shapes.ts` — primitive → Jolt shape (convex radius 0 for thin stock).
  - `integration.ts` — `PhysicsWorld`: compile doc → Jolt bodies/constraints,
    **fixed-dt** step (`1/60`, for determinism), sync transforms back into State only.
- `src/render/` — `Scene.tsx` (Canvas + physics loop in `useFrame`), `PieceMesh.tsx`,
  `HeldPiece.tsx` (ghost placement), `geometry.ts`, `snap.ts`.
- `src/ui/` — `App.tsx` shell, `Toolbar`, `Palette`, `Properties`, `StatusBar`, `storeContext`.
- `src/persistence/` — `autosave.ts` (IndexedDB), `file.ts` (download/open `.neocad.json`, `downloadBlob`).
- `src/export/` — `scene.ts` (document → throwaway Three.Group), `exporters.ts` (glTF/STL).
- Fasteners: `document/catalog.ts` `FASTENERS` (rigid → `fixed`), `physics/integration.ts`
  compiles them to Jolt `FixedConstraint`s; `render/proximity.ts` + `HeldPiece`/`Scene` drive
  the proximity affordance; `render/FastenerMarker.tsx` shows joins.

## Conventions / gotchas

- **Selection signal is an outline, never shading** (`PieceMesh` inverted hull; orange =
  selected, green = proximity/joint target).
- **Joint fasteners store anchors/axis in piece-LOCAL space**; `integration.ts` converts to
  world at compile time using current State, so rebuilds stay consistent after motion.
- **Gizmo commits must bump `worldEpoch`** (`movePieceTransform`) or the paused Jolt body
  keeps the old pose and Run snaps the piece back.
- **Joint clicks snap to features; the CLICKED point is not the anchor.** Mechanical
  parts have real bore holes — a ray through the hole hits nothing (e2e scripts must
  aim at the disc, not the center).
- **Directly-fastened pairs don't collide** (GroupFilterTable) — required because
  mechanical stock collides as solid cylinders.

- **Physics is ambient.** `running` defaults true; Pause freezes stepping.
- **State sync mutates pieces in place** every frame and must NOT go through undo/redo —
  only structural Definition edits are undoable.
- **Determinism depends on fixed dt** (`1/60`) — never pass real frame dt to `step`.
- Three.js skips invisible meshes when raycasting — the held-piece catcher plane is
  transparent (opacity 0), not `visible={false}`.
- Physics world fully rebuilds on structural change (keyed by `structureKey + worldEpoch`);
  incremental add/remove is a later optimization.

## Commands

- `npm run dev` — dev server (Vite).
- `npm test` — Vitest (114 tests; includes deterministic physics scenarios).
- `npm run build` — production build → `dist/`.
- Deploy: push to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages).
  Enable Pages → "GitHub Actions" in repo settings once.

## Workflow note

This project is being built with the superpowers skills: brainstorm → write spec →
write plan → execute plan (TDD, frequent commits) → verify in a real browser before
claiming done. Continue M2 by invoking the writing-plans skill against the Stage 1 spec.
