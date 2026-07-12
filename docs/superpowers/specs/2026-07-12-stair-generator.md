# Stair Generator — spec

A powerful, parametric **3D stair generator**: straight, L/U (90°/180°) turns, winders,
spiral, curved, and arbitrary multi-turn stairs, with full control of every dimension and
live building-code feedback. Standalone eventually; built now on top of NeoCad's exact
manifold CSG machinery so the trunk is reused, not re-invented.

## The core insight — the walkline

Every stair is a **walk along a path in plan (the walkline), extruded upward one step at a
time.** All stair types are just *what path you walk*:

| Type | Walkline |
|---|---|
| Straight | one straight segment |
| L / quarter-turn (90°) | straight → landing (or winders) → straight, +90° |
| U / half-turn (180°) | straight → 180° turn → straight |
| Winder | straight → arc (treads fan around it) → straight |
| Spiral | a tight circular arc (all winders around a pole) |
| Curved / helical | a large-radius arc with a well |
| Custom multi-turn | an arbitrary sequence of the above |

So the generator is: **params → a path of segments → discretize into placed step-frames →
emit geometry → mesh.**

## Architecture (layered — mirrors cuts/SDF)

1. **`src/stairs/spec.ts`** — pure, three-free. `StairSpec`: the serializable parameter
   document (see below). Knows nothing about React, WebGL, or NeoCad's document.
2. **`src/stairs/layout.ts`** — pure, three-free. **The brain.** `layoutStair(spec)` walks
   the path and returns a flat list of **parts** (axis-aligned tread/riser boxes for S0;
   oriented/trapezoid parts for turns/winders later) plus **metrics** (rise, going, run,
   pitch, 2R+G) and **advisories** (informational code checks). 100% unit-testable with
   plain arithmetic — no graphics.
3. **`src/stairs/build.ts`** — `stairToCsg(spec)` folds the parts into a **`CsgNode`** tree
   (extended with a `union` node) and meshes through the **existing manifold kernel**
   (`render/csg.ts`): `csgToGeometry()` for render + export, `csgMeshSync()` for a static
   Jolt `MeshShape` when a stair is dropped into the sandbox (reuses the M-Cuts slice-1b
   anchored-MeshShape path — stairs are anchored, so it's a perfect fit).
4. **Wrappers.** A standalone `?stairs` route (parameter panel + live preview + export),
   and later an "insert into the sandbox as an anchored piece" path.

Manifold (exact, watertight, low-poly, printable) is the right engine — stairs are
hard-edged. SDF only enters later for rounded bullnose nosings.

## StairSpec (grows per slice)

```ts
interface StairSpec {
  totalRise: number        // floor-to-floor height (m) — the vertical the stair must climb
  width: number            // stair width (m)
  going: number            // tread depth / horizontal run per step (m)
  treadThickness: number   // (m)
  nosing: number           // tread overhang past the riser face (m)
  riserMode: 'closed' | 'open'
  riserThickness: number   // (m), closed risers only
  // sizing: pick per-step rise and derive N, or pick N and derive rise
  sizing:
    | { mode: 'byRise'; targetRise: number }   // N = round(totalRise/targetRise)
    | { mode: 'byCount'; count: number }        // rise = totalRise/N
  // S1+: flights: Segment[]  (straight | landing | turn | helix)
  // S2+: stringer: {...}
  // S5+: railing: {...}
  // S6:  code: 'IRC' | 'EU' | 'none'
}
```

### Coordinate frame

Origin at the foot of the stair, floor `y=0`. Ascends **+Z** (going direction), up **+Y**
(rise), width centred on **X** (`x ∈ [−W/2, W/2]`).

### Layout math (straight, S0)

- `N` risers (from sizing), `rise = totalRise / N`, **`treads = N − 1`** (the top step lands
  on the upper floor — equal risers throughout, a hard safety/code requirement).
- Riser `k` (closed): face at `z=(k−1)·G`, `y∈[(k−1)·rise, k·rise]`, thickness `Tr` behind.
- Tread `k` (k=1..N−1): top at `y=k·rise` (thickness `Tt` below), `z∈[(k−1)·G − nosing, k·G]`.
- `totalRun = (N−1)·G`, `pitch = atan(rise/going)`.

### Metrics & informational code (S0)

Compute + display; the pass/fail engine is slice S6. US IRC residential reference bands:
rise ≤ 7¾″ (196mm), going ≥ 10″ (254mm), width ≥ 36″ (914mm); comfort rule 2R+G ≈ 550–700mm.

## Slice plan

- **S0** — pure core + **straight** stair, standalone `?stairs` route, live preview,
  STL/glTF export, metrics/advisory readout. Proves the whole pipeline.
- **S1** — turns via **landings** (L 90°, U 180°): the `Segment[]` path model.
- **S2** — **stringers** (cut/closed/mono via extruded profiles → `extrude` CsgNode).
- **S3** — **winders** (trapezoidal treads fanning a turn; going along the walkline).
- **S4** — **spiral + curved** (arc/helix path, wedge treads, swept stringers).
- **S5** — **railings/balustrade** (newels, rails, balusters, spacing, curve-following).
- **S6** — **code-compliance engine + fit-to-opening solver + cut-list/BOM export.**
- **S7** — **sandbox integration** (insert as an anchored MeshShape piece).

Each slice is standalone-usable and unit-tested.

## Differentiators (the "best around" bet)

Live building-code compliance (green/amber/red as you drag), fit-to-opening solver
(floor-to-floor + footprint → solve N and going), and a cut-list/BOM export for makers who
actually build. No free/web tool does these well.
