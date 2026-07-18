# Snap Rotation Finish-at-Half-Distance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make snap proximity rotation reach the exact correct orientation once the dragged group is within half the snap distance, instead of only at the exact position.

**Architecture:** Remap the single `cap` ramp in `computeSnapProximityRotation` so it still equals the full rotation tolerance at the zone edge (`d = D`) but reaches zero at a configurable fraction of the snap distance (`d = D/2`), clamped to zero for the inner half. The fraction is a module-level experiment constant. Everything else in the drag pipeline is untouched.

**Tech Stack:** TypeScript, Vite, Vitest.

## Global Constraints

- American English for all identifiers, comments, and code artifacts.
- No PRNG / share-link / save-format impact — this is drag-time interaction only; do not touch procedural generation.
- Match surrounding code style in `src/game/snap-proximity-rotation.ts` (JSDoc on exported symbols, local helpers for local concerns).
- Keep the change to the visual ramp only: the merge-qualification gates (`|θ| ≤ T`, `d ≤ D`) and the `excess`/`SNAP_EPSILON_DEG` one-way-ratchet logic stay exactly as they are.
- Test file lives next to source: `src/game/snap-proximity-rotation.test.ts`.

---

### Task 1: Shift the rotation-completion point to half the snap distance

**Files:**
- Modify: `src/game/snap-proximity-rotation.ts` (the module + function doc comments, a new constant, a `clamp01` helper, and the `cap` computation at the current line 129)
- Test: `src/game/snap-proximity-rotation.test.ts` (recompute existing cap-dependent expectations; add three boundary cases)

**Interfaces:**
- Consumes: existing `computeSnapProximityRotation(state, ctx)` and `buildProximityContext(...)` — signatures unchanged.
- Produces: no signature changes. Behavior change only: for `d ≤ D · ROTATION_COMPLETE_AT_FRACTION` the returned correction fully aligns the group (`cap = 0`); for `d = D` the cap equals `T` (unchanged entry).

The tests use `D = tolerancePx = 40` and `T = rotationToleranceDeg = 20`, so the new cap is `cap = 20 · clamp01(d/20 − 1)`. In these fixtures the position offset from the correct center equals the measured distance `d` (e.g. center `x = 180` → `d = 30`).

- [ ] **Step 1: Add the three new boundary tests (they fail on the current linear formula)**

Add these cases inside the `describe('computeSnapProximityRotation', ...)` block in `src/game/snap-proximity-rotation.test.ts`, after the existing `'fully aligns at zero distance'` test:

```ts
it('completes rotation at half the snap distance', () => {
    // d = D/2 = 20 → cap = 20 × clamp01(2·20/40 − 1) = 0; error 15 fully corrected.
    const { state, ctx } = makeComputeSetup({ x: 150 + D / 2, y: 50 }, 15);
    expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-15);
});

it('stays fully aligned across the inner half (plateau below D/2)', () => {
    // d = 10 < D/2 → cap clamps to 0; error 15 fully corrected.
    const { state, ctx } = makeComputeSetup({ x: 160, y: 50 }, 15);
    expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-15);
});

it('leaves the full tolerance uncorrected at the zone edge (no jump on entry)', () => {
    // d = D = 40 → cap = 20 × clamp01(2·40/40 − 1) = 20 = T; error 20 → excess 0 → null.
    const { state, ctx } = makeComputeSetup({ x: 150 + D, y: 50 }, T);
    expect(computeSnapProximityRotation(state, ctx)).toBeNull();
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts -t "half the snap distance"`
Expected: FAIL — the current formula returns `-5` (cap `= 20 × 20/40 = 10`, excess `5`) at `d = D/2`, not `-15`.

- [ ] **Step 3: Add the constant and `clamp01` helper to the source module**

In `src/game/snap-proximity-rotation.ts`, add near the top of the module body (after the imports, before `SnapTolerances`):

```ts
/**
 * Rotation reaches the exact orientation once the dragged group is within
 * this fraction of the snap distance — not only at the exact position. The
 * cap still equals the full rotation tolerance at the zone edge (no jump on
 * entry) and ramps to zero here. Experiment knob: 0 reproduces the original
 * "exact only at d = 0" behavior. Keep it in [0, 1).
 */
const ROTATION_COMPLETE_AT_FRACTION = 0.5;

/** Clamp a value to the unit interval [0, 1]. */
function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}
```

- [ ] **Step 4: Rework the `cap` computation in `computeSnapProximityRotation`**

Replace this line (currently line 129):

```ts
    const cap = ctx.rotationToleranceDeg * (bestDistance / ctx.tolerancePx);
```

with:

```ts
    const ramp =
        (bestDistance / ctx.tolerancePx - ROTATION_COMPLETE_AT_FRACTION) /
        (1 - ROTATION_COMPLETE_AT_FRACTION);
    const cap = ctx.rotationToleranceDeg * clamp01(ramp);
```

Leave the `excess` / `SNAP_EPSILON_DEG` / `return` lines below unchanged.

- [ ] **Step 5: Update the doc comments to describe the new ramp**

In the module header comment, replace the sentence beginning "the allowed angular error is capped at `rotationTolerance * (distance / tolerance)`. Moving closer..." so it reads:

```
 * The rotation is one-way by construction: the allowed angular error is
 * capped by a ramp that equals `rotationTolerance` at the zone edge and
 * reaches zero once within `ROTATION_COMPLETE_AT_FRACTION` of the snap
 * distance. Moving closer tightens the cap (rotation is applied and
 * persists); moving away only loosens it, which never rotates the group
 * back. Pivot-preserving rotation (`rotateGroup`) keeps the group's bbox
 * center fixed, so the measured distance is invariant under the rotation
 * this module applies — the ramp is driven purely by how close the player
 * drags the group.
```

In the `computeSnapProximityRotation` JSDoc, replace the sentence "The correction reduces `|θ|` to `cap = rotationToleranceDeg × (d / tolerancePx)` — at the zone edge the cap equals the tolerance (no jump on entry), at zero distance the group is fully aligned." with:

```
 * The correction reduces `|θ|` to a distance-driven `cap` that equals
 * `rotationToleranceDeg` at the zone edge (no jump on entry) and reaches
 * zero once `d` is within `ROTATION_COMPLETE_AT_FRACTION` of the snap
 * distance, so the group is fully aligned across that inner fraction.
```

- [ ] **Step 6: Recompute the existing cap-dependent test expectations**

Apply these edits in `src/game/snap-proximity-rotation.test.ts`. Cases not listed here (`beyond the snap distance`, `beyond the rotation tolerance`, `fully aligns at zero distance`) are unaffected — leave them as-is.

**(a) "returns null when the angular error is already under the cap (no jump on zone entry)"** — move outward so the smaller new cap still exceeds the error:

```ts
    it('returns null when the angular error is already under the cap (no jump on zone entry)', () => {
        // d = 35 → cap = 20 × clamp01(2·35/40 − 1) = 15; error 10 < 15 → nothing to do.
        const { state, ctx } = makeComputeSetup({ x: 185, y: 50 }, 10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });
```

**(b) "rotates the error down to the distance-scaled cap, and is idempotent at rest"** — move to `d = 30` so the cap is a non-zero `10` (mid-ramp), preserving the partial-correction intent:

```ts
    it('rotates the error down to the distance-scaled cap, and is idempotent at rest', () => {
        // d = 30 → cap = 20 × clamp01(2·30/40 − 1) = 10; error 18 → excess 8, toward alignment (negative).
        const { state, ctx } = makeComputeSetup({ x: 180, y: 50 }, 18);
        const delta = computeSnapProximityRotation(state, ctx);
        expect(delta).toBeCloseTo(-8);

        // Applying the delta and re-evaluating without moving: no oscillation.
        rotateGroup(getGroup(state, 11), state.piecesById, delta!);
        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });
```

**(c) "is wrap-aware: rotations just below 360° rotate forward through 0°"** — move to `d = 30` (cap 10) so it still tests a partial wrap-aware correction:

```ts
    it('is wrap-aware: rotations just below 360° rotate forward through 0°', () => {
        // error = signedAngularDelta(0, 342) = +18; d = 30 → cap = 10 → +8.
        const { state, ctx } = makeComputeSetup({ x: 180, y: 50 }, 342);
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(8);
    });
```

**(d) "never rotates back as the distance increases again (one-way ratchet)"** — approach at `d = 30` (cap 10), then retreat by 6 to `d = 36` where the new cap (16) exceeds the held error (10):

```ts
    it('never rotates back as the distance increases again (one-way ratchet)', () => {
        const { state, ctx } = makeComputeSetup({ x: 180, y: 50 }, 18);
        const group = getGroup(state, 11);

        // Approach: d = 30 → rotated down to the cap (10°).
        rotateGroup(group, state.piecesById, computeSnapProximityRotation(state, ctx)!);
        expect(group.rotation).toBeCloseTo(10);

        // Retreat to d = 36 (cap = 16 > error 10): no correction, rotation stays.
        group.position = { ...group.position, x: group.position.x + 6 };
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
        expect(group.rotation).toBeCloseTo(10);
    });
```

- [ ] **Step 7: Rework the `makeRowState` fixture and its docstring so "closest wins" still discriminates**

Under the new ramp both original mate distances (`d = 8`, `d = 12`) fall in the inner half where `cap = 0`, so both would yield the same delta and the test would no longer distinguish closest-wins from an iteration-order bug. Move both mates into the outer half (`d = 24` closest, `d = 28` farther), where caps differ (`4` vs `8`).

Replace the `makeRowState` docstring and the two position literals. The distances are pure horizontal offsets: `d_leftMate = |cx − 150|`, `d_rightMate = |cx − (group2X − 50)|`.

Update the docstring block above `makeRowState` to:

```ts
/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, each 100×100, mated along
 * vertical edges. Piece 1 (the moved group, id 11) is rotated 16° and both
 * mates are un-rotated; `closest` picks which mate piece 1 sits nearer.
 * Alignment with group 0 (origin) puts piece 1's center at (150, 50);
 * alignment with group 2 puts it at group2.position + (−50, 50). Both mates
 * sit in the outer half of the snap zone so their caps differ:
 *
 * - 'right': group 1 center (178, 50), group 2 at (204, 0) — left mate at
 *   d = 28 (cap 8), right mate at d = 24 (cap 4).
 * - 'left': group 1 center (174, 50), group 2 at (196, 0) — left mate at
 *   d = 24 (cap 4), right mate at d = 28 (cap 8).
 *
 * `getBorderEdges` iterates piece 1's right mate (edge index 1) before its
 * left mate (index 3), so testing BOTH arrangements discriminates genuine
 * closest-wins from first-qualifying-wins and last-qualifying-wins
 * iteration bugs: either bug picks the d = 28 mate (cap 8 → −8) in one of
 * the arrangements instead of the d = 24 mate (cap 4 → −12).
 */
```

Update the two literals inside `makeRowState`:

```ts
    const group1Center = closest === 'right' ? { x: 178, y: 50 } : { x: 174, y: 50 };
    const group2Position = closest === 'right' ? { x: 204, y: 0 } : { x: 196, y: 0 };
```

Update the comment inside the `it.each(...)` closest-wins test to match the new numbers (the `toBeCloseTo(-12)` assertion is unchanged):

```ts
            // Middle piece (1) mated on both sides; see makeRowState above.
            // Closer mate at d = 24 (cap 4), farther at d = 28 (cap 8); error
            // 16 on both. Closest wins: excess = 16 − 4 = 12, toward
            // alignment. Running both arrangements rules out iteration-order
            // (first/last-qualifying-wins) bugs, which would yield −8.
```

- [ ] **Step 8: Run the full proximity-rotation test file and verify green**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: PASS — all cases, including the three new boundary tests and the reworked closest-wins cases.

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS — no other test depends on the old cap ramp.

Run: `npx tsc --noEmit`
Expected: no errors (the new `clamp01` helper and constant typecheck cleanly).

- [ ] **Step 10: Commit**

```bash
git add src/game/snap-proximity-rotation.ts src/game/snap-proximity-rotation.test.ts
git commit -m "feat(snap-rotation): finish rotation at half the snap distance

Rotation still starts correcting at the snap-zone edge but now reaches the
exact orientation once the group is within ROTATION_COMPLETE_AT_FRACTION
(0.5) of the snap distance, instead of only at the exact position."
```

---

### Task 2: Verify in-app feel and confirm help text is still correct

**Files:**
- Check only: `src/ui/info-modal.ts` (no change expected)

- [ ] **Step 1: Confirm the info modal needs no copy change**

Open `src/ui/info-modal.ts` and read the rotation-snapping copy. The existing text describes rotation snapping conceptually, not the distance ramp, so it should remain correct. Only edit if a sentence has become wrong or misleading (per `CLAUDE.md`); do not add copy for behavior a player would already expect. If no change is needed, note that explicitly and move on — no commit.

- [ ] **Step 2: Drive the app and feel the new behavior (quality gate — Adrian's call)**

Run: `npm run dev`, load a puzzle in free-rotation mode, drag a piece toward a matching neighbor, and confirm the piece reaches its exact angle roughly halfway through the snap zone rather than only at the moment it snaps. Whether `0.5` feels right is a subjective tuning decision for Adrian — the mechanism working (rotation completes early) is what this step verifies; report the feel and let Adrian decide whether to tune `ROTATION_COMPLETE_AT_FRACTION`.

---

## Self-Review

**Spec coverage:**
- Formula change (cap reaches 0 at D/2, clamped inner half) → Task 1 Steps 3–4. ✓
- `ROTATION_COMPLETE_AT_FRACTION` module constant, easy to tune, no UI → Task 1 Step 3. ✓
- `clamp01` local helper → Task 1 Step 3. ✓
- Entry unchanged / merge condition unchanged / one-way ratchet preserved → guarded by Task 1 Steps 4 (untouched excess logic) and 6d + new entry-edge test in Step 1. ✓
- Fraction 0 = exact regression anchor → documented in the constant's comment (Step 3). ✓
- Recompute existing cap-dependent tests → Task 1 Step 6 (a–d) + Step 7. ✓
- New tests: completes-at-half, inner-half plateau, entry-unchanged → Task 1 Step 1. ✓
- No PRNG/share-link impact → Global Constraints. ✓
- Info-modal verification → Task 2 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact code. ✓

**Type consistency:** `clamp01(value: number): number` and `ROTATION_COMPLETE_AT_FRACTION` are referenced consistently; `computeSnapProximityRotation`/`buildProximityContext` signatures are unchanged. ✓
