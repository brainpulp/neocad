# Hollow, holes (negative shapes) & rendering upgrade — agreed spec (2026-07-04)

Decisions converged with the user. Execution order: **R1 → M-Hollow → M-Cuts**.
R1 and M-Hollow are Opus-suitable; M-Cuts' geometry core (SDF mesher +
decomposition) is reserved for a Fable session.

## R1 — Rendering upgrade, phase 1 (DO FIRST — one day, biggest visual win)

- HDR **environment lighting**: drei `<Environment>` with a studio/room env
  (or three's RoomEnvironment generated PMREM — no external HDR download,
  keeps the app self-contained). This is what makes metals/glass stop looking
  like clay.
- **ACES filmic tone mapping** + verify three color management is on.
- **Material.finish** schema field `{ metalness?, roughness?, clearcoat? }`,
  honest per-family values in DEFAULT_MATERIALS (metals metalness ~1 rough
  0.3–0.5; plastics clearcoat 0.6; woods matte 0.8; rubber 0.95). PieceMesh
  feeds them to the material. Migration: mergeLibraryMaterials already
  backfills new fields — add `finish` to its backfill list.
- Keep the white Tinkercad look: envmap affects materials, background stays
  clean (Environment background={false}).
- Perf guardrail: nothing in R1 needs a quality toggle; AO/bloom (R2/R3) do.
- Verify: screenshot steel/brass/glass/wood side by side before/after.

## M-Hollow — wall thickness as a property

- `Piece.hollow?: { thickness: number; openFace?: FaceId }` (FaceId =
  '+x'|'-x'|'+y'|'-y'|'+z'|'-z' for boxes; cylinders: open ends = 'tube',
  one open end = 'cup'; sphere: closed shell only in v1).
- PHYSICS (exact, no approximation):
  - box → compound of 6 (closed) or 5 (one open face) thin box walls;
  - cylinder → ring of 10–12 convex prism segments (+ end caps unless open):
    the existing 'tube' stock finally becomes honestly hollow;
  - sphere → shell approximated as compound of hull patches (v1 may keep
    solid collision + honest note; low priority).
- RENDER: parametric geometry (no CSG needed for these regular cases).
- Mass/volume: pieceVolume must subtract the cavity (weight chip + magnetism
  volume both use it).
- Inspector: "Hollow" checkbox + wall-thickness slider (cm) + open-face
  dropdown where applicable. Ghost/placement unchanged.
- Tests: hollow box mass < solid box mass; ball dropped INTO an open-top
  hollow box stays contained (physics compound is real); tube lets a smaller
  dowel pass through its bore (finally true peg-through-tube).

## M-Cuts — Tinkercad-style negative shapes (Fable slice for the core)

- Any piece can be toggled **Hole** (subtractive). Applying a hole to a solid
  records a PARAMETRIC cut on the solid: `Piece.cuts: [{ shape, dims,
  transform (solid-local) }]` — movable, editable, undoable; never baked.
- RENDER: CSG via SDF — the piece's shape becomes an SDF graph (primitive
  minus cuts, hollow = onion |d|−t), meshed by marching cubes in a worker,
  once per edit (never per frame). This seeds the SDF kernel; smooth-blend
  unions (the Clavicula look) ride on the same path later.
- PHYSICS, tiered (the agreed WYSIWYG rule):
  - regular cuts (round/square hole or slot through a face) on ANY piece →
    exact convex decomposition (analytic, per-case);
  - ANY cut on an anchored piece → exact concave MeshShape (statics may be
    concave in Jolt);
  - exotic cuts on MOVING pieces → REFUSED with an advisory ("this cut is
    too complex for a moving part — fix the part in place to use it").
    What you see is always what physics does; no approximate-collision mode.
- Retires: drilling backlog item; the joint veto's bore-exemption (gears get
  real bores); slicing = subtractive half-space, same machinery.

## Sequencing note

R1 touches render only; M-Hollow touches catalog/physics/render but stays
analytic; M-Cuts introduces the SDF mesher. Do not start M-Cuts before
M-Hollow ships — the inspector affordances and pieceVolume changes it needs
land there.
