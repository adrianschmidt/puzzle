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
3. For each edge `Pi → Pj`, build the cubic with control points
   `cp1 = Pi + Ti·(|PiPj|/3)`, `cp2 = Pj − Tj·(|PiPj|/3)` (via
   `Curve.fromBezierPath` or a small local helper), instead of
   `Curve.line`. Endpoints with a straight tangent produce a control point on
   the chord, so a border-touching edge bows only at its interior end
   (asymmetric cubic).

### Overshoot safety

Uniform Catmull-Rom can overshoot and self-intersect at high jitter, which
risks invalid/crossing geometry. Use **centripetal parametrization
(α = 0.5)** and a tension factor tuned so a control-arm length cannot exceed
~⅓ of the shorter adjacent edge. This keeps curves cusp-free and
non-self-intersecting even at jitter 0.5, so the result is reliably "flowing"
and never tangled.

### Frame boundary

Border-touching edges bow at the interior end and stay straight at the border
end (see step 2). For the fringe edges that actually cross the frame
(extended columns at `k = -1` / `k = cols+1`), clip by finding the
frame-intersection parameter on the chord and trimming the curve with
`splitAt`. Because the outer end is straight, the chord intersection is
exact/near-exact there. If precision artifacts appear, revisit — the user has
accepted a "try and adjust" approach here.

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

- With `smooth: true, jitter > 0`, interior edges are non-degenerate curves
  (control points off the chord).
- C1 continuity across a shared interior node: the outgoing tangent of one
  edge matches the incoming tangent of the next edge on the same chain,
  within tolerance.
- With `smooth: true, jitter: 0`, cuts stay collinear (control points on the
  chord).
- All interior endpoints remain within the frame.
- Still exactly one outer PRNG draw regardless of `smooth`.
- No new duplicate interior edges; `buildDCEL` still succeeds.

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
