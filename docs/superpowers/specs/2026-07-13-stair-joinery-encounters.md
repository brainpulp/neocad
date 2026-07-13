# Stair joinery & "encounters" — blueprint-level spec

Goal: move the stair generator from "solid boxes that abut" to **real joinery** — the
cuts, notches, and transition fittings a builder would actually make. Every modality
below is expressed as CSG (box/prism + boolean cut) at an angle that is a function of
the stair pitch θ = `atan(rise/going)`. Sourced from two research passes (stringer
carpentry + handrail joinery); see chat transcript for citations.

Convention: **plumb** = vertical plane (faces a riser), **level** = horizontal plane
(faces a tread). The pitch line runs at θ; notches are rise×going right angles stepped
along it (the "pitch board" — compute `stepᵢ = i·rise`, `runᵢ = i·going` exactly, one
rounding, never iterative addition → zero cumulative error).

## A. Stringer end cuts (top & bottom, horizontal vs vertical)

Each stringer end is terminated by a **plumb cut**, a **level cut**, or both (an L seat).
Expose per end (bottom, top) a mode:

- `plumb` — vertical face only (bears flat against a header/rim; the top-of-flight default).
- `level` — horizontal face only (seat resting flat on a floor/landing).
- `seat` (plumb+level L) — the default floor foot and under-floor top.
- `kicker-notch` (bottom) — rectangular relief in the level cut to index over a kick plate.
- `rim-hook` (top) — back-corner relief (down / over / up) to hang over a rim joist.

Plus a scalar **bottom drop** = deduct one tread thickness from the bottom (± finish-floor
buildup) so step 1 isn't a tread-thickness too tall. Independent toggle/offset.

CSG: the raking board is a box; each end mode subtracts a half-space (plumb = a box cut on
a vertical plane; level = on a horizontal plane; seat = both; notches = a small box subtract).

## B. Notched / housed stringers (fit the steps)

- **open-cut (sawtooth carriage):** subtract a staircase of rise×going right-angle notches
  from the TOP edge of the raking board; treads seat on the level cuts, risers land on the
  plumb cuts, profile exposed. Constraint: keep a **throat ≥ ~90 mm** of solid board below
  the deepest notch corner (drives min board width). This is the classic "cut string".
- **housed (closed/dado):** L-shaped routed pockets (level slot for tread + plumb slot for
  riser), **depth ~10–12 mm** into the inner face, **tapered wider at the back** (show-face
  tight); a **glued wedge** behind tread and behind riser locks them. Hidden from the side.
  (We already approximate this with `closed` = inset treads behind a solid board; the real
  version routs the pockets + wedges.)
- **mixed:** wall string housed, outer string open-cut.

## C. Per-step dimensions overlay (avoid cumulative error)

Toggle on/off. For every step draw the exact **rise** and **going** (and the raking
hypotenuse) as dimension labels, measured from the same datum (top OR bottom selectable) so
a builder transfers marks off one datum — the software equivalent of a pitch board / story
pole. Render as billboarded HTML labels + thin extension lines in the 3D view; also feed the
cut list. Low geometric risk, high maker value.

## D. Encounters — stringers at turns

- `butt-into-trimmer` — string plumb-cuts into the landing rim (today's fascia approach).
- `newel-tenon` — inner strings tenon into a shared landing newel (two flights pivot on it);
  tenon must not encroach the tread/riser housings.
- `mitred-corner-post` — outer string faces mitred at **half the plan turn angle** (45° for
  90°) around a corner post; end grain hidden.
- `return-nosing` — open-end tread nosing mitred at 45° around the open string end.
- `wreathed` — continuous curved outer string (geometrical stairs); advanced, stub as
  mitred-corner for now.

## E. Encounters — railings

Two systems (pick one; drives everything else):

- **post-to-post** — rail segments **die into block-top newel faces**; rail cut square to its
  axis, or its face at (90−θ) to lie on the vertical post; turns handled entirely by the post
  (two rail stubs enter at different heights/directions). Geometrically simple — recommended
  first.
- **over-the-post** — one continuous ribbon over pin-top newels via **fittings** spliced
  tangent (rail bolt + 2 dowels): up-easing, over-easing, gooseneck (N-rise vertical lift to
  clear a landing newel; straight/L/R), quarter-turn (level or rake, ±cap), half-turn cap,
  volute/turnout terminals. Geometrically demanding.

Joints: `railBolt+dowels`, `mortiseTenon+pin`, `miter{θ/2}` (rake-to-level), `dieIntoNewelFace`,
`wallRosette`, `miteredReturn`, `scarf`.

Balusters: bottom = `dovetailTread+returnNosing` (open string) | `shoeRailFillet` (closed);
top = `plowGroove+fillet` | `pinTopDrilled`. **Tops cut at θ** to bed into the plowed rail.
Two-per-tread convention → the two balusters on a tread differ in height by **rise/2**
(rear taller). Gap < 100 mm (already enforced, tread-aligned).

Newels: `starting{pin|block}`, `landing/angle{riserHeight 2–4, two mortises at θ and 0°}`,
`half-newel(wall)`, `balcony`; mount = notch-over-stringer + bolt.

## Recommended build order (each shippable + tested)

1. **Stringer end cuts** (A) + **per-step dims toggle** (C) — unambiguous, high value, low risk.
2. **Open-cut notched stringer** (B) — the "notches to fit steps" ask; exact CSG subtract.
3. **Railing system switch** (E) — post-to-post first (die-into-newel + θ/2 miters), then
   over-the-post fittings (gooseneck for landings is the key one).
4. **Stringer turn encounters** (D) — mitred-corner-post + newel-tenon + return-nosing.
5. **Housed stringer with routed pockets + wedges** (B) and **wreathed string** (D) — advanced.
