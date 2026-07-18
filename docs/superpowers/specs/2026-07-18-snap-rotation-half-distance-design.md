# Snap proximity rotation — finish at half the snap distance

**Date:** 2026-07-18
**Status:** Approved, ready for planning

## Problem

Snap proximity rotation progressively rotates a dragged group toward its
correct orientation as it nears a matching neighbor. Today the group only
reaches the *exact* correct rotation when it is at the *exact* correct
position (`d = 0`) — a point the player rarely lands on precisely. The
result is that the piece is still slightly off-angle right up until it
snaps.

We want the rotation to *finish* earlier: reach the exact angle while the
piece is still slightly away from the correct position, so the inner part
of the approach is spent only closing distance, not angle.

## Current behavior

`computeSnapProximityRotation` in
`src/game/snap-proximity-rotation.ts` caps the *allowed* remaining angular
error as a linear ramp on the simulated-snap distance `d`:

```ts
const cap = ctx.rotationToleranceDeg * (bestDistance / ctx.tolerancePx);
```

With `T = rotationToleranceDeg` and `D = tolerancePx`:

- `d = D` (zone edge) → `cap = T` — no jump on entry.
- `d = 0` (exact position) → `cap = 0` — fully aligned.

Each frame the group is rotated by the `excess` of `|θ|` beyond `cap`, so
`|θ|` is squeezed down to the cap. The correction is one-way: moving closer
tightens the cap and the applied rotation persists; moving away only
loosens the cap and never rotates back.

## Desired behavior

The cap should reach `0` at **half** the snap distance instead of at zero
distance, and stay `0` for the inner half:

- `d = D` (zone edge) → `cap = T` — **unchanged**; rotation still *starts*
  correcting at the same distance as today, with no jump on entry.
- `d = D/2` → `cap = 0` — rotation is now *complete*; the piece is exactly
  aligned.
- `d < D/2` → `cap = 0` (clamped) — already perfectly rotated; only
  distance remains to close.

The "half" is an experiment parameter and must be easy to tune.

## Design

### The formula change

Replace the single `cap` line in `computeSnapProximityRotation`
(`src/game/snap-proximity-rotation.ts`, currently line 129) with a ramp
remapped so the cap hits zero at a configurable fraction of the snap
distance:

```ts
// Rotation reaches the exact orientation once the piece is within this
// fraction of the snap distance — not only at the exact position. This is
// an experiment knob; tune to taste. 0 recovers the original behavior
// (exact only at d = 0).
const ROTATION_COMPLETE_AT_FRACTION = 0.5;

const ramp =
    (bestDistance / ctx.tolerancePx - ROTATION_COMPLETE_AT_FRACTION) /
    (1 - ROTATION_COMPLETE_AT_FRACTION);
const cap = ctx.rotationToleranceDeg * clamp01(ramp);
```

`clamp01(x)` returns `Math.min(1, Math.max(0, x))`. Define it as a small
local helper in this module (no shared util exists for it; keep it local
unless one already turns up during implementation).

The `excess` / `SNAP_EPSILON_DEG` logic below the cap line is unchanged, so
the one-way ratchet and the "already under the cap → return null" short
circuit still hold.

### Constant placement

`ROTATION_COMPLETE_AT_FRACTION` is a module-level `const` in
`snap-proximity-rotation.ts` with a comment explaining it is a tunable
experiment knob and that `0` reproduces the original behavior. No UI, no
persistence, no plumbing through `ProximityContext` — a single edit point.

### Correctness properties preserved

- **Entry unchanged:** at `d = D`, `ramp = 1`, `cap = T`. No jump on zone
  entry.
- **Merge condition unchanged:** only the visual ramp changes; what
  qualifies to merge on drop is untouched.
- **One-way ratchet preserved:** the `excess`/epsilon logic is unchanged.
- **Clamp guards the inner half:** for `d < D/2`, `ramp < 0`, clamped to
  `0`, so `cap = 0` and the group is forced to exact alignment — the same
  end state today reaches only at `d = 0`.
- **Fraction 0 is an exact regression anchor:** with the fraction at `0`,
  `ramp = d/D` and the formula is identical to today's.

### Out of scope

- No PRNG / share-link / save-format impact — this is drag-time
  interaction, not procedural generation.
- No new user-facing setting or slider.
- Merge-detection thresholds and presets are untouched.

## Testing

`src/game/snap-proximity-rotation.test.ts` asserts exact cap values derived
from the old linear formula. Under the new ramp (fraction `0.5`,
`cap = T × clamp01(2·d/D − 1)`) those expectations shift and must be
recomputed for the existing cases, e.g.:

- "rotates the error down to the distance-scaled cap": `d = 20, D = 40,
  T = 20` was `cap = 10`; new `cap = 20 × clamp01(2·0.5 − 1) = 0`, so the
  group fully aligns at `d = D/2`.
- "null when already under the cap (no jump on zone entry)": pick a `d`
  near `D` where the new (smaller) cap still exceeds the test's angular
  error, so the case still exercises "no correction due on entry".
- "fully aligns at zero distance": still holds (cap is `0` for all
  `d ≤ D/2`), but is now a special case of the inner-half plateau.

New cases to add:

- **Completes at half distance:** at `d = D/2`, `cap = 0`, so any in-range
  angular error is fully corrected to exact.
- **Inner-half plateau:** at some `d < D/2`, `cap = 0` (already exact).
- **Entry is unchanged:** at `d = D`, `cap = T` (regression guard on the
  no-jump-on-entry property).

The wrap-aware and one-way-ratchet cases keep testing the same properties;
only their numeric cap expectations are recomputed where they depend on the
ramp.

## Files touched

- `src/game/snap-proximity-rotation.ts` — the constant, the `clamp01`
  helper, the reworked `cap` line, and the doc comment on
  `computeSnapProximityRotation` (which currently states "at zero distance
  the group is fully aligned" — update to reflect the half-distance
  completion).
- `src/game/snap-proximity-rotation.test.ts` — recomputed expectations and
  the new cases above.
- Info modal (`src/ui/info-modal.ts`) — verify during implementation; the
  existing copy describes rotation snapping conceptually rather than the
  distance ramp, so no change is expected. Update only if a sentence
  becomes wrong.
