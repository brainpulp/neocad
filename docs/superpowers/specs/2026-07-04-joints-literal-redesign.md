# Joints, literally — the agreed redesign (2026-07-04)

Converged in discussion with the user. This note is the contract for all further
joint work; do not re-derive it. Vocabulary rule as everywhere in NeoCad: makers'
words, never solver words.

## The thesis

**Joining never creates motion. Joining only bonds.** In the real world you weld,
glue, bolt, nail — always rigid, always in surface contact. Motion between parts
comes from exactly two sources:

1. **Hardware** placed between them — a hinge, a bearing, a slide.
2. **Shape** — a peg in a hole, a ball in a groove (pure collision; needs real
   holes → drilling milestone; no joint tool involved).

The pivot/slider/axle radio buttons are a third thing that doesn't exist in
reality — motion conjured at join time, attached to nothing you can point at.
They are to be retired once hardware covers their cases.

## The joining gesture (one, ever: FASTEN)

- **Pause to join.** Selecting the joint tool pauses the sim; it stays paused after.
- **Second-clicked comes to the first.** Click the part that STAYS, then the part
  you're bringing to it. A fixed part never moves (if the second is fixed, the
  first moves). Both fixed → advisory: *"Both parts are fixed — unfix one to join
  them."* No cleverness (the old smaller-piece heuristic was a patch over
  unpredictability; predictability is the fix).
- **Lands in surface contact.** The clicked surfaces touch — outward normals
  opposed, clicked surface points coincident. Never buried, never floating.
  (The old rule aligned feature AXES, which for anything shaft-like means
  *inside each other* — the dowel-swallowed-by-the-log bug.)
- **Collision veto.** If the solved landing would interpenetrate (beyond a few mm
  of tolerance), refuse with *"Solving this joint would create a collision."*
  Nothing moves, nothing is created. Exemption: true shaft-into-ring pairings
  (a bore feature meeting a cylinder shaft) stay co-axial and are exempt —
  mechanical stock still collides as solid cylinders, so a gear on an axle is
  an "honest lie" until drilling gives us real holes. Drilling retires the
  exemption entirely.
- **WYSIWYG type picker.** Suggestions may only change what the picker DISPLAYS;
  whatever is displayed is exactly what is applied. (The old code silently
  substituted a suggestion at the second click whenever the user hadn't
  re-clicked the radio since re-entering the tool.)
- **Controllable landing.** After landing: flip to the other side, rotate about
  the contact in snap steps, slide along the face, numeric offset. The ADJUST
  machinery exists (adjustJoint); it must move from the inspector panel to
  on-canvas handles at the joint. (Opus batch.)

## The hardware aisle (next milestone after the gesture is sane)

Motion hardware is **stock**: placeable, fastenable parts whose degree of freedom
is intrinsic. Generic first, specific later:

- **Generic hinge** (swing) → skins later: butt, piano, strap, gate…
- **Generic bearing** (spin) → pillow block, flanged bushing…
- **Generic slide** (slide) → drawer slide, rail + carriage…

**Interface, not body** — the one rule that makes generic→specific swapping safe.
A hinge's contract is: two mounting faces + pin axis + swing range. Every skin
implements the same contract; the body is cosmetic. Swapping via a dropdown can
never break welds or motion. Parameters on the generic (leaf size, pin position,
limits); specific skins NARROW parameters, never add. Chunky/toy proportions are
the native look of generic hardware, not a compromise.

**Compiler collapse** — a 30 g hinge between two 5 kg boards is Jolt's worst
mass-ratio case. The document stays literal (hinge part + two welds); the physics
compiler collapses weld–hinge–weld chains and emits ONE hinge constraint directly
between the big parts, using the pin as the axis. The hardware renders and rides
along. (Squarely inside the "physics is a disposable evaluation" doctrine.)

## Explicitly parked

- **Snaps** are modeling aids for specific assembly systems (Lego-like connector
  sets) — deliberately abstract, designed separately, NOT part of the joint model.
- Modeling/sim aids (clamps, tape measure, clash highlight, settle, slow-mo,
  strain coloring, hold-to-test, CG plumb bob) — see BACKLOG.md; they help around
  the joint process but don't solve it.

## Delivery plan

1. **Fable slice (this session):** contact geometry — surface anchors, GJK overlap
   veto, second-to-first mover, pause-to-join, WYSIWYG picker, advisory notices.
   The dense 3D math where wrong-but-plausible is the failure mode.
2. **Opus batch:** on-canvas adjust handles at the joint (flip/rotate/slide/offset),
   retire second-guessing UI, generic hardware trio per this note's contract,
   compiler collapse.
