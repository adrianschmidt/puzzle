# Triangular cut: flowing (smooth) edges option

**Date:** 2026-07-01
**Status:** Approved design, ready for implementation planning

## Summary

Add a boolean `smooth` option to the triangular base-cut generator. When
enabled (and jitter > 0), each cut edge is rendered as a bowed cubic Bézier
whose endpoint tangents are shared with the neighboring edge along the same
lattice line. This replaces the hard angle at each jittered crossing point
with a smooth curve, making the cuts look "flowing" rather than a chain of
straight segments meeting at kinks.

With jitter = 0 the shared tangents are collinear, so the cuts stay visually
straight — the option is a no-op in that case, which is correct.

## Background

The triangular generator (`src/puzzle/topology/triangular-cut-generator.ts`)
tiles the frame with a near-equilateral triangular lattice. Crossing points
("nodes") are stored in a `Map<string, Point>` keyed `"j:k"`. Three families
of grid lines pass through the lattice:

- horizontal (fixed `j`, increasing `k`)
- two diagonal directions (down-left / down-right links to the row below)

Each cut edge belongs to exactly one family, and each interior node lies on
one line from each family — that is why the lines cross there. Today every
edge is emitted as `Curve.line(a, b)` (a straight, single-segment cubic).

The `jitter` option perturbs each interior node by a random polar offset
(`local()`-driven, magnitude up to `jitter * cell`). Border-adjacent nodes
are left unjittered so they cannot cross the frame or fall within the DCEL
vertex-merge tolerance. Under jitter, the straight lines become polylines
with a kink at every crossing.

## Feature

Give the two edges of a line that share a crossing a **common tangent** at
that crossing, so the kink becomes a smooth curve. The three families are
smoothed independently, so the three lines still genuinely cross at the node
(a different tangent for each family) — correct behaviour.

### Algorithm (per-edge, topology-preserving)

The change is purely in the control points of each emitted `Curve`. The DCEL
still sees the **same vertices and same edge count**; only the curve shape
between two fixed vertices changes. Tab-splicing therefore operates on a
bowed base edge instead of a straight one, with no topology change.

1. Build the three edge families as **chains of node keys** along each
   direction (horizontal by increasing `k`; the two diagonal directions from
   the existing down-left / down-right links).
2. Compute the tangent **per endpoint**, not per edge:
   - An endpoint that is a genuine interior crossing (has a chain neighbor on
     **both** sides) → Catmull-Rom tangent, proportional to
     `(P_next − P_prev)` along that chain.
   - An endpoint that is a chain end / unjittered border node → straight
     tangent along the chord to the other endpoint (unchanged from today).
3. For each edge `Pi → Pj` with chain-neighbors `Ph` (before `Pi`) and `Pk`
   (after `Pj`), build the cubic with the classic **uniform Catmull-Rom →
   Bézier** control points:
   `cp1 = Pi + (Pj − Ph)/6`, `cp2 = Pj − (Pk − Pi)/6`.
   When a neighbor is absent (chain end / off-lattice), that end falls back to
   the straight control point `lerp(Pi, Pj, 1/3)` / `lerp(Pi, Pj, 2/3)` —
   identical to `Curve.line`. So a border-touching edge bows only at its
   interior end (asymmetric cubic). The formula is parameter-free.

### Straight-line reproduction (why jitter 0 is a no-op)

The uniform formula reproduces an exact straight line whenever the four chain
points are collinear and evenly spaced — which is precisely the lattice at
jitter 0 (every horizontal step is `colStep`; every diagonal step is
`(±colStep/2, rowHeight)`). So with `smooth: true, jitter: 0` the output is
byte-identical to the straight tiling, and the option only bends cuts once
jitter displaces the crossings. No separate special-casing needed.

### Overshoot safety

The bow magnitude is inherently bounded: a control arm is `|Pj − Ph|/6`,
i.e. proportional to the neighbor spread over 6, so with jitter ≤ 0.5 the
per-edge deflection stays modest and a single cubic cannot self-loop. This is
the v1 choice for its simplicity and exact straight-line reproduction. If
visual testing at high jitter shows overshoot or cuts tangling across
neighboring lines, the documented fallback is **centripetal parametrization
(α = 0.5)** and/or a tension clamp limiting the control arm to ~⅓ of the
shorter adjacent edge — deferred unless observed.

### Frame boundary

Bow only edges whose **both endpoints lie within the frame** `[0,w]×[0,h]`
(bounds inclusive). Edges with an endpoint outside the frame — the extended
fringe columns at `k = -1` / `k = cols+1` — stay straight and are clipped with
the existing `clipSegmentToFrame` + `Curve.line`, exactly as today. This
sidesteps clipping a bowed cubic entirely.

Border-row nodes (`j = 0` / `j = rows`, on `y = 0` / `y = h`) and even-row
left/right nodes (`k = 0` / `k = cols`, on `x = 0` / `x = w`) are *on* the
frame, so they count as in-frame and their edges bow — straight at the
on-frame side (its beyond-neighbor is off-lattice → straight control point)
and Catmull-Rom at the interior side. That is the "inner end adjusted like any
other" behaviour requested; only the truly off-frame fringe stubs stay fully
straight.

A cut curve could in principle bulge outside the frame between two in-frame
endpoints. In practice interior nodes sit ~`cell` from the border while the
bow is ~neighbor-spread/6, so the curve stays inside; this is **verified by a
test that samples points along every curve** and asserts they remain within
`[0,w]×[0,h]`. If that test ever fails, the fix is to clamp each control point
into the frame (a cubic stays within its control points' convex hull).

### Randomness

None. Smoothing is fully deterministic from node positions. No new
`random()` or `local()` calls, so the one-outer-draw PRNG reproducibility
contract is preserved unchanged.

## Wiring

- **Generator config** — `TriangularCutConfig`
  (`triangular-cut-generator.ts`): add `smooth: boolean`; parse in `generate`
  with default `false`.
- **Composable config** (`src/game/composable-config.ts`): add
  `DEFAULT_SMOOTH = false`, add `smooth` to `ComposableSliderPreference`,
  clamp it in `parseComposableConfig`, and include it in the triangular
  branch of `composableSliderToGeneratorConfig`.
- **New-game dialog** (`src/ui/new-game-dialog.ts`): add a checkbox to
  `triangularControls` (testid `composable-smooth-toggle`), and read it in
  `getValues()`. Add `smooth` to `ComposableSliderConfig`.
- **Share-link** (`src/sharing/share-link.ts`): the key rides through
  `cf.bgc` automatically and is finite-safe as a boolean. No new caps entry
  needed.

## Testing

Unit tests in `triangular-cut-generator.test.ts`:

Helper (`catmullRomBezierEdge`):
- Collinear, evenly-spaced neighbors → segment equals `Curve.line`.
- C1 continuity: for two adjacent edges sharing a vertex and Catmull-Rom
  neighbors, the first edge's end tangent equals the second's start tangent.
- A missing neighbor → straight control point (equals `Curve.line`).

Generator:
- `smooth` defaults off: interior edges are single straight segments.
- `smooth: true, jitter: 0` → cuts stay collinear (control points on chord).
- `smooth: true, jitter > 0` → at least one interior edge is bowed (a control
  point off the chord).
- Exactly one outer PRNG draw with `smooth: true`.
- Same interior edge count with `smooth` on vs off (only shape differs).
- Sampled points along every curve stay within the frame (bulge safety).
- Existing suite (endpoints in frame, no duplicates, determinism, curve
  budgets) continues to pass.

Add a round-trip assertion for `smooth` to the existing triangular
share-link test. The flat-edge measurement harness
(`tab-rejection-measurement.test.ts`) can be reused ad hoc but is not a gate.

## Help text

No change. The triangular style is not yet documented in the info modal (not
released in production), so adding copy for a sub-option of an undocumented
style would be premature. The modal stays correct without it; whoever
documents triangular at release can mention the toggle then.

## Out of scope

- Exposing curve intensity / tension as a user-facing slider (a boolean
  toggle was chosen; a slider can be added later without breaking share
  links).
- Any change to tab generation beyond confirming splicing works on a bowed
  base edge.
