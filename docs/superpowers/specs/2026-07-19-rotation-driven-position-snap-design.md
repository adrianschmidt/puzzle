# Rotation-driven position snap — the mirror of snap proximity rotation

**Date:** 2026-07-19
**Status:** Approved, ready for planning

## Problem

Snap proximity rotation handles one direction of the "close enough to
merge" approach: when a group is already *rotated* within the rotation
tolerance and the player then *moves* it into the snap distance, the group
progressively rotates to the exact orientation as the remaining distance
shrinks.

The opposite entry order gets no such feedback. When a group is already
*inside* the snap distance but *not yet* rotated within the rotation
tolerance, and the player then *rotates* it into the tolerance, nothing
moves — the group only snaps into position on drop.

We want the mirror behavior: as the rotation enters the rotation tolerance,
the group starts sliding toward its correct position, and reaches the exact
position as the rotation reaches exactly correct. The same one-way ratchet
applies — rotating *worse* again must never push the group back out.

Rotation is one-dimensional, so a player who keeps rotating a piece
inevitably sweeps *through* the exact angle; that is why position completing
exactly at `θ = 0` (rather than at some earlier fraction) is the right
target here, unlike the distance-driven direction where the exact position
is a 2D point the player rarely lands on.

## Current behavior

`computeSnapProximityRotation` in `src/game/snap-proximity-rotation.ts`
caps the *allowed* remaining angular error as a ramp on the simulated-snap
distance `d`, and applies the excess rotation via `rotateGroup` (pivoting on
the group's bbox center, so `d` is invariant to the applied rotation). Its
controller, `SnapProximityRotationController`, is driven from the
translation drag path: `onGroupMoved()` fires after each `moveGroup`, frame-
gated to one evaluation per animation frame.

There is no equivalent driven by the rotation gesture. The rotation gesture
is the floating rotate handle (`src/ui/rotate-handle.ts`, free-mode only):
its `pointermove` fires `onRotate(groupId, deltaDeg)`, whose host callback
(`src/main.ts`) calls `rotateGroup(...)`. The handle ends via `onCommit`
(which runs merge detection) or a silent cancel. It exposes no start/stop
host hook today.

The shared geometry primitive, `measureEdgeAlignment`
(`src/game/merge-detection.ts`), already returns everything both directions
need: `rotationDelta` (`θ`), `distance` (`d`, measured *after* simulating
the rotation snap), and `snapDelta` (the positional correction to the
rotation-corrected placement).

## Desired behavior

Symmetric to the rotation ramp, but with the roles of distance and angle
swapped. With `D = tolerancePx` (snap distance) and `T = rotationToleranceDeg`
(rotation tolerance), cap the *allowed positional error* by a ramp on the
angular error `θ`:

- `|θ| = T` (rotation just enters the tolerance) → `cap_pos = D` — no jump
  on entry (the group is already within `D`, so nothing moves yet).
- `|θ| → 0` (rotation reaches exact) → `cap_pos → 0` — the group reaches its
  exact position.
- The ramp is linear (`G = 0` in the terms below): position completes
  exactly at `θ = 0`, not at an earlier fraction of `T`.

As the player rotates toward correct, `cap_pos` shrinks and the group is
translated to keep the measured distance at `cap_pos`. Because the rotation
gesture pivots on the bbox center and `d` is measured after simulating the
rotation snap, `d` is invariant to the player's rotation — it responds only
to the translation this feature applies. Applying the correction therefore
drives `d` down to `cap_pos` without the two axes fighting.

The correction is one-way, exactly as in the rotation direction: rotating
*worse* raises `cap_pos`, so the excess goes non-positive and nothing moves.

## Design

Approach: mirror the existing feature as a new single-purpose pure module
plus a sibling controller, sharing the per-gesture context with the rotation
module through a small extracted module. No logic change to the proven
rotation path.

### The formula

New pure function `computeSnapProximityPosition(state, ctx): Point | null`
in `src/game/snap-proximity-position.ts`. It walks the same candidate border
edges as the rotation function, keeps only candidates that would merge on
drop (`|θ| ≤ T` **and** `d ≤ D`), and picks the smallest `d`:

```ts
// Position reaches the exact placement once rotation reaches exact
// (θ = 0). The cap equals the full snap distance at the rotation-tolerance
// edge (no jump on entry) and ramps linearly to zero at θ = 0.
const cap = ctx.tolerancePx *
    clamp01(Math.abs(bestRotationDelta) / ctx.rotationToleranceDeg);
const excess = bestDistance - cap;
if (excess <= SNAP_EPSILON_PX) return null;

const factor = excess / bestDistance;          // in (0, 1]
return { x: bestSnapDelta.x * factor, y: bestSnapDelta.y * factor };
```

- At `θ = 0`, `cap = 0`, `factor = 1` → the full `snapDelta` is applied.
  `snapDelta` is exactly the merge correction, so the group lands in the
  exact placement.
- `factor = excess / bestDistance` scales `snapDelta` so the *remaining*
  measured distance is `cap`. (`|snapDelta|` and `distance` differ only by
  sub-pixel amounts once rotation is within tolerance — both endpoints
  align after the simulated snap — and any residual self-corrects on the
  next frame, since the function is effectively idempotent once
  `d ≈ cap`.)

`SNAP_EPSILON_PX` is a new small constant (the positional analog of
`SNAP_EPSILON_DEG`), defined in the position module.

### The one-way ratchet (no stored state)

The ratchet needs no extra state — the group's `position` is its own memory,
mirroring how `group.rotation` is the rotation ratchet's memory:

- After a correction, `d ≈ cap`, so on the next frame `excess ≈ 0` →
  `null`. Idempotent.
- Rotating *closer* to correct shrinks `cap` below the current `d` →
  `excess > 0` → the group translates further in and the new position
  persists.
- Rotating *worse* raises `cap` above the current `d` → `excess ≤ 0` →
  `null`. The group never moves back out.

### Shared-context extraction

Extract the per-gesture context — currently defined in
`snap-proximity-rotation.ts` — into a new module
`src/game/snap-proximity-context.ts`:

- `SnapTolerances`
- `ProximityContext`
- `buildProximityContext(state, groupId, tolerances): ProximityContext | null`
  (returns `null` off free-rotation mode, unknown group, no cross-group
  mates, or degenerate/non-finite tolerances — all inherited by both
  directions for free)
- `clamp01`

`snap-proximity-rotation.ts` imports these from the new module instead of
defining them. To avoid churning that module's existing importers, re-export
the moved names from `snap-proximity-rotation.ts` if any importer relies on
them being there; otherwise update the imports. Its `computeSnapProximity-
Rotation` logic is unchanged.

`snap-proximity-position.ts` imports the same shared context.

### Controller and wiring

New `src/interaction/snap-proximity-position-controller.ts`,
`SnapProximityPositionController`, mirroring the rotation controller:

- `start(groupId)` — builds the context via `buildProximityContext`, resets
  the frame gate.
- `onGroupRotated()` — frame-gated to one evaluation per animation frame;
  computes `computeSnapProximityPosition` and, if non-null, applies it with
  the `moveGroup` **model helper** (`src/model/helpers.ts`), so it does not
  re-enter the interaction-layer `moveGroup` callback (no re-entrancy into
  `snapRotation.onGroupMoved()`).
- `stop()` — discards the context. Any translation already applied stays,
  matching the rotation feature's cancel semantics (it moved the group
  *toward* correct, so keeping it is harmless).

Rotate-handle hooks (`src/ui/rotate-handle.ts`): add
`onRotateStart?(groupId)` and `onRotateEnd?(groupId)` to
`RotateHandleOptions`, fired at `pointerdown` and at both commit **and**
cancel (in `finalizeDrag`).

Host wiring (`src/main.ts`): instantiate the controller near the rotate
handle, reusing the same state accessor and `activeSnapTolerances` that feed
`snapRotation`. Then:

- `onRotateStart → controller.start(groupId)`.
- Inside the existing `onRotate` callback, call `controller.onGroupRotated()`
  **after** `rotateGroup(...)` and **before** `renderer.renderState(...)`,
  so the applied translation is included in the render — the exact mirror of
  `snapRotation?.onGroupMoved()` sitting right after `moveGroup`.
- `onRotateEnd → controller.stop()`.

Mirror the rotation feature's single-group guard: only track when the
rotated (focused) group is not part of a multi-group selection.

### Correctness properties preserved

- **No jump on entry:** at `|θ| = T`, `cap = D ≥ d`, so `excess ≤ 0` and
  nothing moves the instant rotation enters the tolerance.
- **Exact at θ = 0:** `cap = 0`, full `snapDelta` applied — exact placement.
- **Merge condition unchanged:** only the visual approach changes; what
  qualifies to merge on drop is untouched (same `|θ| ≤ T`, `d ≤ D`).
- **One-way ratchet:** the group's `position` is the memory; worsening
  rotation raises the cap and yields `null`.
- **Axes do not fight:** the rotation gesture pivots on the bbox center and
  `d` is post-rotation-snap, so `d` is invariant to the player's rotation
  and responds only to this feature's translation.
- **Reuses guards:** free-rotation-mode / mates / finite-tolerance guards
  come from the shared `buildProximityContext`.

### Out of scope

- No PRNG / share-link / save-format impact — this is drag-time
  interaction, not procedural generation, and consumes no `random()`.
- No new user-facing setting, slider, or button.
- Merge-detection thresholds and presets are untouched.
- The quarter-turn rotation UI (`rotate-buttons.ts`) is unaffected — the
  feature is free-rotation only (enforced by `buildProximityContext`).

## Testing

New `src/game/snap-proximity-position.test.ts`, mirroring
`snap-proximity-rotation.test.ts` and anchoring fixtures to the tolerances:

- **Beyond distance → null:** `d > D` disqualifies the candidate.
- **Beyond rotation → null:** `|θ| > T` disqualifies the candidate.
- **No jump on entry:** at `|θ| = T`, `cap = D`, so an in-range `d ≤ D`
  yields `null`.
- **Progressive translate:** as `|θ|` shrinks, the returned translation grows
  so the remaining distance tracks `cap = D·(|θ|/T)`.
- **Exact at θ = 0:** returns the full `snapDelta`.
- **One-way ratchet:** rotate in → translation applied; rotate back out →
  `null`, position held.
- **Closest qualifying mate wins:** among multiple candidates, the smallest
  `d` drives the correction.

New `src/interaction/snap-proximity-position-controller.test.ts`, mirroring
the rotation controller test: lifecycle (`start`/`stop` build and discard
context) and frame gating (one evaluation per scheduled frame; injectable
scheduler).

`src/ui/rotate-handle.test.ts` (or equivalent): the new `onRotateStart` /
`onRotateEnd` hooks fire at `pointerdown` and at both commit and cancel.

## Files touched

- `src/game/snap-proximity-context.ts` — **new.** Extracted `SnapTolerances`,
  `ProximityContext`, `buildProximityContext`, `clamp01`.
- `src/game/snap-proximity-rotation.ts` — import the shared context from the
  new module (re-export if needed); logic otherwise unchanged.
- `src/game/snap-proximity-position.ts` — **new.**
  `computeSnapProximityPosition`, `SNAP_EPSILON_PX`.
- `src/interaction/snap-proximity-position-controller.ts` — **new.**
  `SnapProximityPositionController`.
- `src/ui/rotate-handle.ts` — add `onRotateStart` / `onRotateEnd` hooks.
- `src/main.ts` — instantiate and wire the controller into the rotate-handle
  lifecycle and the `onRotate` callback.
- Tests: `snap-proximity-position.test.ts` (new),
  `snap-proximity-position-controller.test.ts` (new), rotate-handle tests
  (new hooks). Existing `snap-proximity-rotation` tests should be unaffected
  by the extraction; verify their imports still resolve.
- Info modal (`src/ui/info-modal.ts`) — no change expected; verify during
  implementation and update only if a sentence becomes wrong. This surfaces
  the earned snap early without changing the merge outcome, which a player
  would naturally expect.
