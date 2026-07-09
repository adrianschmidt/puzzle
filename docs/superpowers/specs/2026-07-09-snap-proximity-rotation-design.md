# Snap Proximity Rotation — Design

**Date:** 2026-07-09
**Status:** Approved for planning

## Summary

When free rotation is enabled and a dragged group comes close enough to a
matching neighbour that dropping it would snap them together (within both
the positional snap distance and the rotation tolerance), the dragged
group progressively rotates toward the snapped orientation as the
distance decreases. The rotation is one-way: retreating from the
neighbour never rotates the group back. This is visual feedback that the
snap is already available — the merge condition is unchanged, and the
piece would snap on drop regardless.

Naming note: this is deliberately **not** called an "assist" — it does
not change what qualifies for a snap. It surfaces an already-earned snap
earlier. Code and docs use "snap proximity rotation".

## Behaviour

- Active only while dragging a group, and only when
  `state.rotationMode === 'free'`.
- Activation condition per candidate edge pair is exactly the merge
  condition: positional edge distance `d ≤ D` (active snap distance) and
  angular error `|θ| ≤ T` (active rotation tolerance), measured with the
  same math `detectMerges` uses.
- Among qualifying candidates, the one with the smallest `d` wins.
- Cap formula: `cap = T × (d / D)`. If `|θ| > cap`, rotate the group by
  the signed excess so `|θ| = cap`; otherwise do nothing.
  - At the snap-radius edge (`d = D`) the cap equals `T`, so a group
    that has just entered the zone is never rotated abruptly.
  - At `d = 0` the cap is `0`: fully aligned.
  - The ratchet is implicit: approaching shrinks the cap (rotation is
    applied and persists), retreating loosens the cap (no rotation is
    ever applied away from alignment).
- Rotation is applied via the existing pivot-preserving `rotateGroup()`
  (bbox-centre pivot). Position is never nudged — rotation only.
- Merging still happens only on drop. No behaviour change to
  `detectMerges` outcomes.
- Applies to any dragged group (single piece or multi-piece).
- No interaction with rotation-handle drags — positional drags only.

## Architecture

### 1. Shared measurement helper (pure extraction)

Extract the per-edge-pair measurement out of `checkEdgeAlignment` in
`src/game/merge-detection.ts` into a reusable `measureEdgeAlignment()`
returning `{ distance, angularDelta }` for a border edge and its mate,
given current group transforms. `detectMerges` keeps thresholding on the
measurements exactly as today — drop-merge behaviour stays bit-identical.
Both merge detection and snap proximity rotation consume the same
helper, guaranteeing "rotation activates ⇔ drop would merge".

### 2. New module `src/game/snap-proximity-rotation.ts`

Pure function:

```
computeSnapProximityRotation(state, movedGroupId, candidates, D, T): number | null
```

- Iterates precomputed candidate edge pairs (see §3), measures each,
  filters to `d ≤ D && |θ| ≤ T`, picks smallest `d`.
- Applies the cap formula; returns the signed rotation delta to apply,
  or `null` when no rotation is needed.
- Caller applies the delta with `rotateGroup()`.

### 3. Drag-start precomputation (the performance core)

During a drag, only the dragged group moves, and merges happen only on
drop — so the set of border edges **and** the world-space endpoints of
all mate edges are constant for the whole drag. At drag start (only when
`rotationMode === 'free'`):

- Compute `getBorderEdges()` once for the dragged group.
- Cache each mate edge's world endpoints.

Per pointer-move, the only fresh math is transforming the dragged
group's own edge endpoints — a few multiply-adds per border edge.

### 4. Drag-controller hook, frame-gated

In `src/interaction/drag-controller.ts` pointer-move, after
`moveGroup()`:

- Skip entirely unless free rotation and a candidate cache exists.
- Evaluate at most once per animation frame (pointer events can outpace
  rAF; skip if already evaluated this frame).
- Apply any returned delta with `rotateGroup()` before
  `requestRender()`.

Cost profile: zero when rotation mode isn't `free`; one cheap loop over
cached candidates per frame while dragging far from any mate.

## Out of scope

- No new setting — always on with free rotation (revisit if the feature
  is kept).
- No analytics.
- No help-text change for now: existing info-modal sentences remain
  correct. If the feature survives playtesting, consider one sentence
  then.
- No positional nudging, no mid-drag merging, no spatial index.

## Testing

Unit tests next to `snap-proximity-rotation.ts`:

- Cap math: full alignment at `d = 0`; no-op just outside `d = D`.
- Ratchet: approach then retreat returns `null` (no reverse rotation).
- Candidate selection with multiple qualifying mates (closest wins).
- No-op when outside either tolerance, and when `rotationMode` is not
  `'free'`.

Merge-detection regression: `detectMerges` results unchanged by the
`measureEdgeAlignment()` extraction.

Interaction-level test: a drag that passes near a mate leaves the
rotation permanently adjusted after the pointer moves away.

## Risk to watch in playtesting

`rotateGroup` pivots around the group's bbox centre, so an applied
rotation slightly shifts geometry under the finger. Max correction is
bounded by the rotation tolerance (10–40° depending on preset) spread
over the approach, so it should read as magnetic guidance rather than a
jump — but this is the thing to feel-test.
