# Piece-anchored snap pivot (issue #530)

Improve snap-proximity auto-rotation and merge detection for large groups
by anchoring the rotation-snap pivot on the connecting piece instead of the
moved group's bbox center.

## Problem

`measureEdgeAlignment` measures mate-edge distance **after simulating the
rotation snap around the moved group's bbox center**. For a large group
mis-rotated by θ, the candidate edge sits at lever-arm distance r from the
group center, so the simulated correction sweeps the edge by ≈ r·θ. A
visually-flush edge on a big group can measure 40+ px against the 18 px
tolerance, so the drop-merge refuses — and since both snap-proximity
assists qualify candidates with the same measurement, they never engage
either. The same piece alone would have snapped.

## Decisions made during brainstorming

- **Scope: whole pipeline.** The measurement is shared by drop-merge
  detection and both assists, and `mergeGroups` applies the rotation snap
  the measurement simulates. All of it moves to the piece-anchored pivot,
  preserving the "assist qualifies exactly when a drop would merge"
  invariant. Drop-merges deliberately become more permissive for big
  groups.
- **Assist pivot: follow-the-winner.** Each frame the applied rotation
  pivots on the current best candidate's piece. Chosen over a sticky latch
  because it is simpler; if it feels wrong in play, sticky-winner is the
  agreed fallback.
- **Rejected alternatives.** Raw distance without simulation (snapDelta
  still needs the simulation; less accurate). Size-compensated tolerance
  (keeps the group-center pivot, so the connecting edge itself teleports
  by r·θ on drop).

## Design

### 1. Measurement — `src/game/merge-detection.ts`

`measureEdgeAlignment` simulates the rotation snap around the **moved
piece's own center**: pivot in group-local space =
`group.pieces.get(pieceId)` offset + center of `piece.bounds`. O(1), no
bounds traversal. The optional `movedCenterLocal` parameter (which existed
only to skip that traversal) is deleted. `distance` and `snapDelta` keep
their meaning ("after the simulated snap"); only the anchor changes.

### 2. Merge application — `src/game/group-merging.ts`

`mergeGroups` applies the real rotation snap around the winning
candidate's moved-piece center (it already has `best.movedPiece` via
`MergeCandidate`), passing that pivot to `rotateGroup`'s existing pivot
parameter. Rename that parameter to `pivotLocal` — its math preserves
whatever local point it is handed; "bbox center" was only ever the
callers' choice. Measurement and application pivot on the same point, so
`snapDelta` stays exact: a merged pair lands in perfect alignment, the
connecting edge stays put on drop, and the far end swings in.

### 3. Rotation assist — `src/game/snap-proximity-rotation.ts` + `src/interaction/snap-proximity-rotation-controller.ts`

`computeSnapProximityRotation` returns `{ deltaDeg, pivotLocal } | null`,
where `pivotLocal` is the current winning candidate's piece center. The
controller passes that pivot to `rotateGroup` instead of
`ctx.centerLocal`. The one-way ratchet survives: the measurement simulates
the full snap around the same pivot the assist rotates around, so the
winner's measured distance is invariant under the assist's own rotation —
the same argument as today, relocated to the piece pivot.

### 4. Position assist + context — `src/game/snap-proximity-position.ts`, `src/game/snap-proximity-context.ts`

The position assist needs no logic change — it inherits the measurement.
`ProximityContext.centerLocal` loses its last consumer and is removed;
`buildProximityContext` drops its `getGroupLocalBounds` call.

### 5. Invariants and edge cases

- **Single-piece groups:** the piece center is the group bbox center, so
  behavior is exactly unchanged. Only multi-piece groups are affected —
  precisely the issue's target.
- **Quarter-turn mode:** rotation delta is always ~0, the snap context
  short-circuits to null; nothing changes.
- **Cascade merges:** each cascade round re-detects with per-candidate
  pivots; no special handling.
- **Candidate comparison:** each candidate's distance is measured with its
  own pivot; "smallest distance wins" now means "closest to its snapped
  placement when anchored on its own piece".
- **Accepted trade-off:** a big group dropped with angular error remaining
  still swings its far end by r·θ on merge — inherent to allowing such
  merges. The rotation assist mitigates it by driving θ to 0 during the
  drag.
- Module doc comments describing the bbox-center invariant
  (`snap-proximity-rotation.ts`, `snap-proximity-position.ts`,
  `group-merging.ts`) are falsified by this change and get corrected or
  shed per the comment policy.

### 6. Testing

- Regression anchor: single-piece-group measurements identical
  before/after.
- The issue's scenario: wide multi-piece group, flush candidate edge, θ
  within tolerance — old measurement exceeds tolerance, new measurement
  ≈ 0, merge succeeds.
- Post-merge exactness: after a θ≠0 merge, mate endpoints coincide.
- Ratchet one-way property still holds under the new pivot.
- Assist returns the winner's pivot and the controller applies it.
- Existing tests touching `movedCenterLocal`/`centerLocal` get updated.
- Geometry-digest tripwire untouched (no generation changes); no PRNG
  involvement.

### 7. Non-changes

No help-text update (this makes snapping match player expectation). No new
analytics events. Merge-tolerance presets keep their meanings. The manual
rotate control (`rotation-ui.ts`) keeps rotating around the group center.
