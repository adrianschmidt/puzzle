# Free rotation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `'free'` rotation mode to composable puzzles, with a single round drag-handle replacing the CCW/CW button pair; merging tolerates ±10° angular misalignment and snaps both rotation and position on merge.

**Architecture:** Extends `rotationMode` with a third value `'free'`. Merge detection swaps its exact-equality rotation gate for an angular-tolerance check using a new `signedAngularDelta` helper, and simulates a rotation snap before computing the position snap. `mergeGroups` applies the rotation snap before the position snap. A new `rotate-handle` component (parallel to `rotate-buttons`) handles the drag gesture: `pointerdown` captures the group's bbox-centre as the pivot and the pointer's angle to it; `pointermove` rotates the group so the pointer-to-pivot angle stays constant. `main.ts` swaps which component is mounted based on `rotationMode`. The new-game dialog gains a sub-checkbox in the composable section, gated on the existing rotation toggle.

**Tech Stack:** TypeScript, Vitest, Vite. Tests run with `npm test` (or `npx vitest run <file>` for a single file).

**Prerequisites:** PR 1 from `docs/superpowers/plans/2026-05-06-rotation-as-degrees-refactor.md` must be merged first — this plan assumes `PieceGroup.rotation` is already a `number` in degrees and `rotateGroup(group, piecesById, deltaDegrees)` is the current API.

**See:** `docs/superpowers/specs/2026-05-06-free-rotation-design.md` for the broader design.

---

## File map

**Modify:**
- `src/model/types.ts` — extend `rotationMode` to include `'free'`.
- `src/model/helpers.ts` — add `signedAngularDelta`.
- `src/game/init.ts` — add `'free'` branch to `pickInitialRotation`.
- `src/game/merge-detection.ts` — angular tolerance gate; simulate rotation snap for position alignment.
- `src/game/group-merging.ts` — apply rotation snap inside `mergeGroups`.
- `src/sharing/share-link.ts` — `'free'` mode encoding/decoding (integer 0–359 in `mr`/`sr`).
- `src/game/reconstruct-groups.ts` — interpret `mr`/`sr` based on `rotationMode`.
- `src/ui/new-game-dialog.ts` — "Free rotation" sub-checkbox.
- `src/ui/index.ts` — re-export the new preference helpers.
- `src/main.ts` — `startNewGame` rotationMode plumbing; mode-aware UI swap.
- `src/ui/info-modal.ts` — help-text updates per `CLAUDE.md`.
- `src/analytics/index.ts` (or wherever `NewGameData`/`PuzzleCompletedData` lives) — extend `rotationMode` typing.
- `src/style.css` — `.rotate-handle` styles, mirroring `.rotate-button` patterns.

**Create:**
- `src/ui/rotate-handle.ts` — new drag-handle component.
- `src/ui/rotate-handle.test.ts` — gesture-math tests.
- `src/ui/free-rotation-preference.ts` — localStorage helper for the new sub-checkbox.
- `src/ui/free-rotation-preference.test.ts`.

**Test:** Updates to `merge-detection.test.ts`, `group-merging.test.ts`, `init.test.ts`, `share-link.test.ts`, `new-game-dialog.test.ts`.

---

## Task 1: Add `signedAngularDelta` helper

**Files:**
- Modify: `src/model/helpers.ts`
- Test: `src/model/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/model/helpers.test.ts`:

```ts
import { signedAngularDelta } from './helpers.js';

describe('signedAngularDelta', () => {
    it('returns 0 for equal angles', () => {
        expect(signedAngularDelta(0, 0)).toBe(0);
        expect(signedAngularDelta(90, 90)).toBe(0);
    });

    it('returns the smallest signed delta in (-180, 180]', () => {
        expect(signedAngularDelta(10, 0)).toBe(10);
        expect(signedAngularDelta(0, 10)).toBe(-10);
        expect(signedAngularDelta(170, 10)).toBe(160);
        expect(signedAngularDelta(10, 170)).toBe(-160);
    });

    it('wraps correctly across the 0/360 boundary', () => {
        expect(signedAngularDelta(359, 1)).toBe(-2);
        expect(signedAngularDelta(1, 359)).toBe(2);
        expect(signedAngularDelta(355, 5)).toBe(-10);
        expect(signedAngularDelta(5, 355)).toBe(10);
    });

    it('returns +180 (not -180) for an exactly opposite pair', () => {
        // Convention: (-180, 180]. Boundary value is +180, not -180.
        expect(signedAngularDelta(180, 0)).toBe(180);
    });

    it('handles unnormalised inputs', () => {
        expect(signedAngularDelta(720, 0)).toBe(0);
        expect(signedAngularDelta(-90, 0)).toBe(-90);
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: failing — `signedAngularDelta` is undefined.

- [ ] **Step 3: Implement**

Append to `src/model/helpers.ts`:

```ts
/**
 * Smallest signed angular delta from `b` to `a` in degrees, in the
 * half-open range `(-180, 180]`.
 *
 * Wrap-aware: the delta between 359° and 1° is `-2`, not `-358`. Useful
 * for tolerance comparisons (e.g. `Math.abs(signedAngularDelta(...)) < 10`).
 *
 * `a − b` is the convention: positive when `a` is "ahead" of `b` going
 * clockwise.
 */
export function signedAngularDelta(a: number, b: number): number {
    const raw = (((a - b) % 360) + 540) % 360 - 180;
    return raw === -180 ? 180 : raw;
}
```

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/helpers.ts src/model/helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(helpers): add signedAngularDelta

Wrap-aware smallest signed difference between two degree values,
landing in (-180, 180]. Used by free-rotation merge detection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `rotationMode` to include `'free'`

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/game/init.ts` (`InitOptions.rotationMode`)
- Modify: `src/sharing/share-link.ts` (`SharePayload.r` and `isValidPayload`)
- Modify: `src/persistence/serialization.ts` (`SerializedGameState.rotationMode`, `resolveRotationMode`)
- Modify: `src/analytics/index.ts` (`NewGameData.rotationMode`, `PuzzleCompletedData.rotationMode`) — find the actual types file; analytics may live elsewhere.

- [ ] **Step 1: Locate every `rotationMode` type literal**

```bash
grep -rn "'none' | 'quarter-turn'" src --include='*.ts'
```

Each match's union must extend to `'none' | 'quarter-turn' | 'free'`.

- [ ] **Step 2: Update `model/types.ts`**

Edit the `GameState.rotationMode` jsdoc and type:

```ts
    /**
     * How (or whether) groups in this puzzle can be rotated by the player.
     *
     * - `'none'`: rotation is disabled; all groups stay at rotation 0.
     * - `'quarter-turn'`: 90°-snapped rotation via toolbar buttons.
     * - `'free'`: continuous rotation via a drag handle. Merge alignment
     *   tolerates ±10° angular misalignment.
     *
     * Defaults to `'none'` when absent.
     */
    rotationMode?: 'none' | 'quarter-turn' | 'free';
```

- [ ] **Step 3: Propagate to `InitOptions`, `SharePayload`, `SerializedGameState`, analytics types**

For each match found in Step 1, widen the union to include `'free'`. In `share-link.ts`, also update `isValidPayload`'s validator:

```ts
// before
if (p.r !== 'none' && p.r !== 'quarter-turn') return false;

// after
if (p.r !== 'none' && p.r !== 'quarter-turn' && p.r !== 'free') return false;
```

- [ ] **Step 4: Update `resolveRotationMode` in `serialization.ts`**

```ts
function resolveRotationMode(
    data: SerializedGameState,
    groups: PieceGroup[],
): 'none' | 'quarter-turn' | 'free' {
    if (
        data.rotationMode === 'quarter-turn' ||
        data.rotationMode === 'none' ||
        data.rotationMode === 'free'
    ) {
        return data.rotationMode;
    }

    if (groups.some((g) => g.rotation !== 0)) {
        return 'quarter-turn';
    }

    if (data.cutStyle === 'fractal') {
        return 'quarter-turn';
    }

    return 'none';
}
```

(Old saves that lack the field still infer `'quarter-turn'` whenever any group rotation is non-zero — `'free'` is only used when explicitly recorded, so legacy saves never get accidentally promoted to free mode.)

- [ ] **Step 5: Run build to surface remaining type errors**

```bash
npm run build
```

Expected: clean build. Any remaining errors point to a missed call site.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(types): extend rotationMode with 'free'

Adds the third rotation mode value. No new behaviour yet — the
new value is reserved for the upcoming free-rotation gesture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Init randomisation for free mode

**Files:**
- Modify: `src/game/init.ts:134-137`
- Test: `src/game/init.test.ts`

- [ ] **Step 1: Add a failing test**

Append a new `it` to the existing `describe('rotationMode', ...)` block in `src/game/init.test.ts`:

```ts
it('assigns random float-degree rotations when rotationMode is "free"', () => {
    const state = createNewGame('image.jpg', { width: 1080, height: 720 }, { width: 800, height: 600 }, undefined, {
        cutStyle: 'composable',
        rotationMode: 'free',
        composableConfig: { /* defaults */ },
        random: () => 0.5,    // deterministic for the assertion
    });

    expect(state.rotationMode).toBe('free');
    for (const group of state.groups) {
        expect(group.rotation).toBeGreaterThanOrEqual(0);
        expect(group.rotation).toBeLessThan(360);
    }
    // With random() returning 0.5 every call, every rotation should be 180°.
    for (const group of state.groups) {
        expect(group.rotation).toBeCloseTo(180);
    }
});

it('uses the same seeded PRNG for free-mode rotation as for cuts', () => {
    const state1 = createNewGame('image.jpg', { width: 1080, height: 720 }, { width: 800, height: 600 }, undefined, {
        cutStyle: 'composable',
        rotationMode: 'free',
        seed: 42,
    });
    const state2 = createNewGame('image.jpg', { width: 1080, height: 720 }, { width: 800, height: 600 }, undefined, {
        cutStyle: 'composable',
        rotationMode: 'free',
        seed: 42,
    });

    for (let i = 0; i < state1.groups.length; i++) {
        expect(state1.groups[i].rotation).toBeCloseTo(state2.groups[i].rotation);
    }
});
```

(Patch the `createNewGame` arguments to match what your file's existing tests use — the snippet above is illustrative.)

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/init.test.ts
```

Expected: failing — current `pickInitialRotation` only handles `'quarter-turn'`.

- [ ] **Step 3: Update `pickInitialRotation`**

Edit `src/game/init.ts:134-137`:

```ts
// before
const pickInitialRotation: () => number =
    options.rotationMode === 'quarter-turn'
        ? () => Math.floor(random() * 4) * 90
        : () => 0;

// after
const pickInitialRotation: () => number =
    options.rotationMode === 'quarter-turn'
        ? () => Math.floor(random() * 4) * 90
        : options.rotationMode === 'free'
        ? () => random() * 360
        : () => 0;
```

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/game/init.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/init.ts src/game/init.test.ts
git commit -m "$(cat <<'EOF'
feat(init): support 'free' rotationMode at puzzle init

Each group's initial rotation is drawn as `random() * 360` from
the puzzle's seeded PRNG. Same seed → same rotations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Angular tolerance gate in `merge-detection.ts`

**Files:**
- Modify: `src/game/merge-detection.ts`
- Test: `src/game/merge-detection.test.ts`

The change has two parts: (a) replace the exact-rotation gate with a tolerance check, and (b) simulate the rotation snap before computing position alignment so the snap-delta accounts for the corrected orientation.

- [ ] **Step 1: Add failing tests**

Append to `src/game/merge-detection.test.ts`:

```ts
import { MERGE_ROTATION_TOLERANCE_DEG } from './merge-detection.js';

describe('checkEdgeAlignment with angular tolerance', () => {
    it('rejects pairs whose rotations differ by more than the tolerance', () => {
        // Two groups built so they would align positionally if rotations
        // matched. Set movedGroup.rotation = targetGroup.rotation + 15.
        // (Reuse the existing test fixtures in this file.)
        // Expect aligned === false.
    });

    it('accepts pairs whose rotations differ by less than the tolerance', () => {
        // Set movedGroup.rotation = targetGroup.rotation + 5.
        // Expect aligned === true with a snapDelta that pulls the moved
        // group into perfect alignment AFTER simulating rotation snap.
    });

    it('accepts pairs whose rotations match exactly (quarter-turn behaviour)', () => {
        // Same rotation. Expect aligned === true and the snapDelta unchanged
        // from current behaviour (rotation simulation is a no-op when delta = 0).
    });

    it('correctly handles wrap-around (e.g. moved=355°, target=5°)', () => {
        // Delta is 10° (just at tolerance). Should still align if positions match.
    });

    it('exposes MERGE_ROTATION_TOLERANCE_DEG = 10', () => {
        expect(MERGE_ROTATION_TOLERANCE_DEG).toBe(10);
    });
});
```

(Inspect the existing `checkEdgeAlignment` tests for the helper functions / fixtures they share, and reuse those.)

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/merge-detection.test.ts
```

Expected: failing — `MERGE_ROTATION_TOLERANCE_DEG` and the new behaviour don't exist.

- [ ] **Step 3: Update `merge-detection.ts`**

(a) Add the constant near the existing `MERGE_TOLERANCE_PX`:

```ts
/**
 * Maximum angular misalignment (degrees) at which two groups can still
 * merge. In quarter-turn mode the rotations are always exactly equal, so
 * the tolerance is a no-op; in free mode it gives the player ±10° of
 * slop on rotation.
 */
export const MERGE_ROTATION_TOLERANCE_DEG = 10;
```

(b) Replace the rotation gate. The current code is:

```ts
// before
if (movedGroup.rotation !== targetGroup.rotation) {
    return { aligned: false, snapDelta: { x: 0, y: 0 } };
}
```

Replace with:

```ts
// after
import { signedAngularDelta } from '../model/helpers.js';

// ...

const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
if (Math.abs(rotDelta) > MERGE_ROTATION_TOLERANCE_DEG) {
    return { aligned: false, snapDelta: { x: 0, y: 0 } };
}
```

(c) Replace the world-position computation for the moved edge endpoints with the post-rotation-snap projection. Add a small helper:

```ts
import { localToWorld, rotatePoint, normaliseDegrees } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Where would `pieceLocal` (a piece-local point on `pieceId`) end up in
 * world space if `group` were rotated by `extraDeg` around its bbox
 * centre, the way `rotateGroup` does the snap?
 *
 * For `extraDeg === 0` this collapses to the existing `getWorldPosition`
 * call, so quarter-turn mode is unaffected.
 */
function getWorldPositionAfterRotationSnap(
    pieceLocal: Point,
    pieceId: number,
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    extraDeg: number,
): Point {
    if (Math.abs(extraDeg) < 1e-9) {
        return getWorldPosition(pieceLocal, pieceId, group);
    }

    const offset = group.pieces.get(pieceId);
    if (!offset) throw new Error(`Piece ${pieceId} not in group ${group.id}`);
    const localInGroup = { x: offset.x + pieceLocal.x, y: offset.y + pieceLocal.y };

    // World position of the bbox centre under the current rotation —
    // the rotation pivot, which stays fixed during a snap.
    const bounds = getGroupLocalBounds(group, piecesById);
    const centreLocal = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };
    const worldCentre = localToWorld(centreLocal, group);

    // Post-snap world position = worldCentre + R(localInGroup - centreLocal, newRotation).
    const newRotation = normaliseDegrees(group.rotation + extraDeg);
    const offsetFromCentre = {
        x: localInGroup.x - centreLocal.x,
        y: localInGroup.y - centreLocal.y,
    };
    const rotated = rotatePoint(offsetFromCentre, newRotation);
    return { x: worldCentre.x + rotated.x, y: worldCentre.y + rotated.y };
}
```

Update `checkEdgeAlignment`'s signature to take `piecesById` (needed by the helper) and rewrite the moved-endpoint block:

```ts
export function checkEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    tolerance: number = MERGE_TOLERANCE_PX,
): { aligned: boolean; snapDelta: Point } {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > MERGE_ROTATION_TOLERANCE_DEG) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }

    // Simulate rotation snap before measuring position alignment.
    const movedStart = getWorldPositionAfterRotationSnap(
        movedEdge.start, movedPiece.id, movedGroup, piecesById, rotDelta,
    );
    const movedEnd = getWorldPositionAfterRotationSnap(
        movedEdge.end, movedPiece.id, movedGroup, piecesById, rotDelta,
    );

    const targetStart = getWorldPosition(targetEdge.start, targetPiece.id, targetGroup);
    const targetEnd = getWorldPosition(targetEdge.end, targetPiece.id, targetGroup);

    const dist1 = distance(movedStart, targetEnd);
    const dist2 = distance(movedEnd, targetStart);
    const avgDist = (dist1 + dist2) / 2;

    if (avgDist > tolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }

    const snapDelta: Point = {
        x: targetEnd.x - movedStart.x,
        y: targetEnd.y - movedStart.y,
    };

    return { aligned: true, snapDelta };
}
```

(d) Update `detectMerges` (and any other call site of `checkEdgeAlignment`) to pass `piecesById`. Search:

```bash
grep -rn "checkEdgeAlignment(" src --include='*.ts'
```

For each call site, pass `state.piecesById` (or the equivalent local).

- [ ] **Step 4: Run merge-detection tests, verify passing**

```bash
npx vitest run src/game/merge-detection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the rest of the suite — no regressions**

```bash
npm test
```

Expected: PASS. If any quarter-turn-mode merge tests now fail, the rotation-snap simulation has a bug for the `extraDeg === 0` path; verify the early-return.

- [ ] **Step 6: Commit**

```bash
git add src/game/merge-detection.ts src/game/merge-detection.test.ts
git commit -m "$(cat <<'EOF'
feat(merge-detection): angular tolerance gate (10°) and snap simulation

Replaces the exact-rotation gate with a wrap-aware ±10° tolerance.
Position alignment is now computed against the moved group's
endpoints AS IF it had already been rotation-snapped, so the
returned snapDelta correctly accounts for the rotation correction
that mergeGroups will apply.

In quarter-turn mode the rotation delta is always 0, so the
simulation collapses to a no-op and behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Apply rotation snap inside `mergeGroups`

**Files:**
- Modify: `src/game/group-merging.ts`
- Test: `src/game/group-merging.test.ts`

The merge step previously assumed both groups already shared the same rotation. With free mode they may differ by up to 10°; the moved group's rotation must be snapped to the target's before the position snap is applied.

- [ ] **Step 1: Add failing tests**

Append to `src/game/group-merging.test.ts`:

```ts
describe('mergeGroups with rotation snap', () => {
    it('snaps the moved group rotation to the target rotation', () => {
        // Build a state where movedGroup.rotation = 92, targetGroup.rotation = 90,
        // and a snapDelta that pulls them into alignment after the snap.
        // After mergeGroups, expect movedGroup-now-merged-into-target to have
        // rotation === 90 (target's value).
    });

    it('is a no-op for already-aligned rotations (quarter-turn parity)', () => {
        // Both at rotation 90. Existing assertion behaviour should hold.
    });
});
```

- [ ] **Step 2: Run, verify failing for the new case**

```bash
npx vitest run src/game/group-merging.test.ts
```

- [ ] **Step 3: Update `mergeGroups`**

In `src/game/group-merging.ts`:

```ts
import { rotateGroup } from './rotate-group.js';
import { signedAngularDelta, /* existing imports */ } from '../model/helpers.js';

export function mergeGroups(
    state: GameState,
    movedGroup: PieceGroup,
    targetGroup: PieceGroup,
    snapDelta: Point,
): PieceGroup {
    // Snap the moved group's rotation to the target's first. The pivot is
    // the moved group's bbox centre (rotateGroup's invariant) — the
    // snapDelta returned by merge-detection was computed assuming this
    // snap would happen first.
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > 1e-9) {
        rotateGroup(movedGroup, state.piecesById, rotDelta);
    }

    // Then snap position into perfect alignment.
    moveGroup(movedGroup, snapDelta);

    // From here, both groups share the same rotation, so the existing
    // local-frame piece-offset rebasing is correct.
    const rawDiff: Point = {
        x: movedGroup.position.x - targetGroup.position.x,
        y: movedGroup.position.y - targetGroup.position.y,
    };
    const inverseDeg = normaliseDegrees(-targetGroup.rotation);
    const localDelta = rotatePoint(rawDiff, inverseDeg);

    for (const [pieceId, offset] of movedGroup.pieces) {
        targetGroup.pieces.set(pieceId, {
            x: offset.x + localDelta.x,
            y: offset.y + localDelta.y,
        });
        state.pieceToGroup.set(pieceId, targetGroup);
    }

    return targetGroup;
}
```

- [ ] **Step 4: Run group-merging tests, verify passing**

```bash
npx vitest run src/game/group-merging.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/group-merging.ts src/game/group-merging.test.ts
git commit -m "$(cat <<'EOF'
feat(group-merging): snap rotation before position on merge

Free-rotation puzzles can produce mate pairs whose rotations differ
by up to 10°. mergeGroups now applies a rotation snap (around the
moved group's bbox centre) before the position snap, mirroring the
order assumed by merge-detection's snapDelta computation.

For quarter-turn merges the rotation delta is 0, so the snap is a
no-op and behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Share-link encoding for `'free'`

**Files:**
- Modify: `src/sharing/share-link.ts`
- Modify: `src/game/reconstruct-groups.ts`
- Test: `src/sharing/share-link.test.ts`
- Test: `src/game/reconstruct-groups.test.ts`

The wire format stays at `v: 1`. When `r === 'free'`, `mr` and `sr` carry **integer 0–359** values instead of the 0–3 quarter-turn integers used for `r === 'quarter-turn'`. Existing quarter-turn share links continue to work.

- [ ] **Step 1: Add failing tests**

Append to `src/sharing/share-link.test.ts`:

```ts
it('round-trips free-mode rotations as integer 0–359 in mr/sr', () => {
    const state: GameState = /* build a free-mode state with merged + solo groups
                                 carrying float rotations like 47.3°, 312.8° */;

    const payload = gameStateToPayload(state, { includeProgress: true });
    expect(payload.r).toBe('free');
    // mr values are integers in [0, 360)
    for (const v of payload.pr!.mr ?? []) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(360);
    }

    // Round-trip through encode → decode gives back rotations within 0.5° of source.
    const encoded = encodePayload(payload);
    const decoded = decodePayload(encoded)!;
    expect(decoded).not.toBeNull();
    // (assertions specific to which group has which rotation)
});

it('keeps quarter-turn round-trip behaviour unchanged', () => {
    // Build a quarter-turn state with rotations in {0,90,180,270}, encode,
    // assert mr is [0..3], decode, assert restored rotations are degrees.
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/sharing/share-link.test.ts
```

- [ ] **Step 3: Update the encoder**

In `src/sharing/share-link.ts`, replace the `extractProgress` rotation block with mode-aware encoding:

```ts
if (state.rotationMode === 'quarter-turn') {
    pr.mr = merged.map((g) => Math.round(g.rotation / 90));
    const sr: number[] = [];
    for (const g of state.groups) {
        if (g.pieces.size !== 1) continue;
        if (g.rotation === 0) continue;
        const [pieceId] = g.pieces.keys();
        sr.push(pieceId, Math.round(g.rotation / 90));
    }
    if (sr.length > 0) pr.sr = sr;
} else if (state.rotationMode === 'free') {
    // Free mode encodes integer degrees 0..359 directly. Solo pieces are
    // virtually always at non-zero rotation, so the sparse encoding becomes
    // effectively dense, but keep the format for consistency with v: 1.
    pr.mr = merged.map((g) => Math.round(g.rotation) % 360);
    const sr: number[] = [];
    for (const g of state.groups) {
        if (g.pieces.size !== 1) continue;
        if (g.rotation === 0) continue;
        const [pieceId] = g.pieces.keys();
        sr.push(pieceId, Math.round(g.rotation) % 360);
    }
    if (sr.length > 0) pr.sr = sr;
}
```

- [ ] **Step 4: Update the decoder (`reconstruct-groups.ts`)**

In the `applyProgress` function, the `mr`/`sr` values are restored to `group.rotation`. Branch on the rotation mode:

```ts
const isFree = state.rotationMode === 'free';

// merged groups
if (progress.mr) {
    for (let i = 0; i < progress.mr.length; i++) {
        const wireValue = progress.mr[i];
        groups[i].rotation = isFree ? wireValue : wireValue * 90;
    }
}

// solo pieces
if (progress.sr) {
    for (let i = 0; i < progress.sr.length; i += 2) {
        const pieceId = progress.sr[i];
        const wireValue = progress.sr[i + 1];
        const group = state.pieceToGroup.get(pieceId);
        if (group) {
            group.rotation = isFree ? wireValue : wireValue * 90;
        }
    }
}
```

(Adapt to the actual variable names and structure of `reconstruct-groups.ts`. Read the file first.)

- [ ] **Step 5: Run share-link and reconstruct-groups tests**

```bash
npx vitest run src/sharing/share-link.test.ts src/game/reconstruct-groups.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts src/game/reconstruct-groups.ts src/game/reconstruct-groups.test.ts
git commit -m "$(cat <<'EOF'
feat(share-link): encode free-rotation angles as integer 0–359

Wire format stays at v: 1. For r === 'free', mr and sr carry
integer degrees 0..359; for r === 'quarter-turn', they continue
to carry 0..3 quarter-turn integers (existing behaviour).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `puzzle-free-rotation-enabled` localStorage preference

**Files:**
- Create: `src/ui/free-rotation-preference.ts`
- Create: `src/ui/free-rotation-preference.test.ts`
- Modify: `src/ui/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `src/ui/free-rotation-preference.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
    FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
} from './free-rotation-preference.js';

describe('free rotation preference', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('defaults to false when nothing is saved', () => {
        expect(loadFreeRotationEnabledPreference()).toBe(false);
    });

    it('round-trips through save → load', () => {
        saveFreeRotationEnabledPreference(true);
        expect(loadFreeRotationEnabledPreference()).toBe(true);

        saveFreeRotationEnabledPreference(false);
        expect(loadFreeRotationEnabledPreference()).toBe(false);
    });

    it('writes under the documented localStorage key', () => {
        saveFreeRotationEnabledPreference(true);
        expect(window.localStorage.getItem(FREE_ROTATION_ENABLED_PREFERENCE_KEY)).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/free-rotation-preference.test.ts
```

- [ ] **Step 3: Implement the preference**

Mirror the existing `src/ui/rotation-preference.ts` exactly:

```ts
/**
 * Free-rotation-enabled preference — sub-checkbox under the composable
 * options in the new-game dialog. Only meaningful when the top-level
 * "Enable rotation" toggle is also on AND the cut style is composable.
 */

import { createBooleanPreference } from './preference-store.js';

export const FREE_ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-free-rotation-enabled';

const store = createBooleanPreference({
    key: FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    defaultValue: false,
});

export const loadFreeRotationEnabledPreference = store.load;
export const saveFreeRotationEnabledPreference = store.save;
```

- [ ] **Step 4: Re-export from the UI barrel**

In `src/ui/index.ts`, add:

```ts
export {
    FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    loadFreeRotationEnabledPreference,
    saveFreeRotationEnabledPreference,
} from './free-rotation-preference.js';
```

- [ ] **Step 5: Run, verify passing**

```bash
npx vitest run src/ui/free-rotation-preference.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/free-rotation-preference.ts src/ui/free-rotation-preference.test.ts src/ui/index.ts
git commit -m "$(cat <<'EOF'
feat(free-rotation-preference): localStorage-backed sub-toggle

Mirror of rotation-preference. Stored separately so it persists
across new-game flows even while the composable section is hidden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: New-game dialog — "Free rotation" sub-checkbox

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Test: `src/ui/new-game-dialog.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `src/ui/new-game-dialog.test.ts`:

```ts
describe('free rotation sub-checkbox', () => {
    it('is hidden when "Enable rotation" is unchecked', () => {
        // Render dialog with savedRotationEnabled: false.
        // Assert: no element matching .free-rotation-row, or it has display:none.
    });

    it('is hidden when cut style is not composable', () => {
        // Render with savedRotationEnabled: true, savedCutStyleIndex pointing to fractal.
        // Assert: hidden.
    });

    it('appears when rotation is enabled AND cut style is composable', () => {
        // Render with savedRotationEnabled: true, savedCutStyleIndex pointing to composable.
        // Assert: visible.
    });

    it('produces rotationMode "free" when both toggles are on at submit', () => {
        // Render, tick the sub-checkbox, click a size button.
        // Assert: onSelect was called with a selection whose computed rotationMode would be 'free'.
        // (Either expose the rotationMode in NewGameSelection, or assert against
        // freeRotation flag and let main.ts compute the mode.)
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/new-game-dialog.test.ts
```

- [ ] **Step 3: Update the dialog**

(a) Extend `NewGameSelection` and `NewGameDialogOptions`:

```ts
export interface NewGameSelection {
    sizeIndex: number;
    cutStyleIndex: number;
    composableConfig?: ComposableSliderConfig;
    fractalConfig?: FractalDialogConfig;
    rotationEnabled: boolean;
    /** True iff cut style is composable AND rotation is enabled AND user ticked the free-rotation sub-checkbox. */
    freeRotation: boolean;
    imageSource: string;
    imageCategory: string;
    vibrant: boolean;
}

export interface NewGameDialogOptions {
    // ...existing...
    savedFreeRotationEnabled?: boolean;
}
```

(b) Build the sub-row (use `appendCheckboxRow` already in this file). The free-rotation sub-checkbox lives **outside** `buildComposableSlidersSection` because its visibility depends on TWO conditions (rotation enabled + composable). Add a top-level row:

```ts
// Inside createNewGameDialog, after building rotationCheckbox and the cut-style picker:
const freeRotationRow = document.createElement('div');
freeRotationRow.className = 'free-rotation-row';
const freeRotationCheckbox = appendCheckboxRow(
    freeRotationRow,
    'Free rotation',
    options.savedFreeRotationEnabled ?? false,
);

function updateFreeRotationVisibility(): void {
    const visible =
        rotationCheckbox.checked &&
        currentCutStyleIndex === composableCutIndex;
    freeRotationRow.style.display = visible ? 'block' : 'none';
}

rotationCheckbox.addEventListener('change', updateFreeRotationVisibility);
updateFreeRotationVisibility();
```

Append `freeRotationRow` to the dialog **immediately after** `rotationRow` so the toggle's nested option appears right beneath it.

Hook into the cut-style picker's `onSelect` to also call `updateFreeRotationVisibility()` (alongside the existing `setVisible` calls):

```ts
const cutStyleSection = createCutStylePicker({
    selectedIndex: currentCutStyleIndex,
    onSelect: (index) => {
        currentCutStyleIndex = index;
        sizeSection.updateLabels();
        fractalSection.setVisible(index === fractalCutIndex);
        composableSection.setVisible(index === composableCutIndex);
        updateFreeRotationVisibility();
    },
});
```

(c) Wire `freeRotation: freeRotationCheckbox.checked` into the size-button onPick payload:

```ts
onSelect({
    sizeIndex,
    cutStyleIndex: currentCutStyleIndex,
    composableConfig: /* existing */,
    fractalConfig: /* existing */,
    rotationEnabled: rotationCheckbox.checked,
    freeRotation: rotationCheckbox.checked
        && currentCutStyleIndex === composableCutIndex
        && freeRotationCheckbox.checked,
    ...imageSourceSection.getValues(),
});
```

(d) Optional CSS in `style.css`: indent the free-rotation sub-row visually (a few extra pixels of `padding-left` on `.free-rotation-row`) to suggest it's nested under the rotation toggle. Keep it small.

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/ui/new-game-dialog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/style.css
git commit -m "$(cat <<'EOF'
feat(new-game-dialog): add Free rotation sub-checkbox

Visible only when 'Enable rotation' is on AND the cut style is
composable. Defaults to off. Persists separately in localStorage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `main.ts` — wire rotation mode and persist new preference

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Persist the new preference and pass it through**

In the `createNewGameButton`'s `onNewGame` handler:

```ts
const savedFreeRotationEnabled = loadFreeRotationEnabledPreference();
createNewGameDialog({
    container: app,
    selectedIndex: preferredIndex,
    selectedCutStyleIndex: preferredCutStyleIndex,
    savedComposableConfig,
    savedFractalConfig,
    savedRotationEnabled,
    savedFreeRotationEnabled,
    // ...etc
    onSelect: ({ sizeIndex, cutStyleIndex, composableConfig, fractalConfig, rotationEnabled, freeRotation, imageSource, imageCategory, vibrant }) => {
        // ...existing saves...
        saveFreeRotationEnabledPreference(freeRotation);
        // ...
        void startNewGame(
            toGridSize(option),
            cutStyle,
            composableConfig,
            imageSource,
            imageCategory,
            fractalConfig,
            vibrant,
            rotationEnabled,
            freeRotation,
        );
    },
});
```

Also extend the boot-time `startNewGame` invocation that uses `loadFreeRotationEnabledPreference()`.

- [ ] **Step 2: Update `startNewGame` signature and rotationMode derivation**

In `src/main.ts`, change `startNewGame` to accept a new boolean `freeRotation` and compute the rotation mode:

```ts
async function startNewGame(
    gridSize: GridSize,
    cutStyle: CutStyle = 'classic',
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig,
    imageSource?: string,
    imageCategory?: string,
    fractalConfig?: FractalDialogConfig,
    vibrant: boolean = false,
    rotationEnabled: boolean = false,
    freeRotation: boolean = false,
): Promise<void> {
    // ...existing setup...

    let rotationMode: 'none' | 'quarter-turn' | 'free' = 'none';
    if (rotationEnabled) {
        rotationMode =
            freeRotation && cutStyle === 'composable' ? 'free' : 'quarter-turn';
    }

    // ...rest unchanged, but use this rotationMode in createNewGame and analytics...
}
```

- [ ] **Step 3: Build, verify clean**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(main): plumb free-rotation flag through startNewGame

Computes rotationMode as 'free' iff rotation is enabled AND the
cut style is composable AND the player ticked the sub-checkbox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Scaffold the `rotate-handle` component

**Files:**
- Create: `src/ui/rotate-handle.ts`
- Modify: `src/style.css`
- Modify: `src/ui/index.ts` (re-export)

This task lays down the lifecycle (focus subscription, spawn/teardown, fade-in/out, idle timeout) but **without** the gesture math yet — that arrives in Task 11.

- [ ] **Step 1: Create the file with the lifecycle scaffolding**

Create `src/ui/rotate-handle.ts`:

```ts
/**
 * Free-rotation drag handle — a single round button that floats below the
 * focused group's bbox. A drag that originates on this handle rotates the
 * focused group continuously, with the angle from the group's bbox-centre
 * to the pointer kept constant for the duration of the drag.
 *
 * Gesture math is added in a follow-up step. This file currently
 * implements the lifecycle / placement / fade scaffolding only.
 */

import type { RotationFocus } from '../interaction/rotation-focus.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BUTTON_SIZE_PX = 44;
const BUTTON_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 12;
const IDLE_TIMEOUT_MS = 5000;
const QUICK_FADE_MS = 100;
const SLOW_FADE_MS = 750;

export interface RotateHandleOptions {
    container: HTMLElement;
    rotationFocus: RotationFocus;
    /**
     * Emitted continuously during drag; the host applies the rotation
     * to the live `PieceGroup` and re-renders. Filled in by Task 11.
     */
    onRotate: (groupId: number, deltaDegrees: number) => void;
    /**
     * Emitted on drag end, after the final `onRotate`. The host runs
     * merge-detection here. Filled in by Task 11.
     */
    onCommit: (groupId: number) => void;
    /** Project the focused group's visual bounds into screen-space. */
    getFocusedGroupScreenBounds: (groupId: number) =>
        | { left: number; right: number; top: number; bottom: number }
        | null;
    getViewportSize?: () => { width: number; height: number };
}

export interface RotateHandleHandle {
    show: () => void;
    hide: () => void;
    destroy: () => void;
}

interface ActiveHandle {
    groupId: number;
    button: HTMLButtonElement;
    idleTimerId: ReturnType<typeof setTimeout> | null;
    removalTimerId: ReturnType<typeof setTimeout> | null;
    transitionEndListener: ((e: Event) => void) | null;
    state: 'visible' | 'fade-out-quick' | 'fade-out-slow';
}

function makeBidirectionalRotateIcon(): SVGElement {
    // Two opposing curved arrows forming a closed circle.
    // Uses the same stroke-width / colour conventions as the existing
    // rotate-button icon. Tweak the path data if a single artist provides
    // a polished glyph.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    // Top half: clockwise arc with arrowhead.
    const arc1 = document.createElementNS(SVG_NS, 'path');
    arc1.setAttribute('d', 'M3 12 A9 9 0 0 1 21 12');
    svg.appendChild(arc1);
    const head1 = document.createElementNS(SVG_NS, 'polyline');
    head1.setAttribute('points', '21 5 21 12 14 12');
    svg.appendChild(head1);

    // Bottom half: counter-clockwise arc with arrowhead.
    const arc2 = document.createElementNS(SVG_NS, 'path');
    arc2.setAttribute('d', 'M21 12 A9 9 0 0 1 3 12');
    svg.appendChild(arc2);
    const head2 = document.createElementNS(SVG_NS, 'polyline');
    head2.setAttribute('points', '3 19 3 12 10 12');
    svg.appendChild(head2);

    return svg;
}

function makeButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'rotate-handle';
    button.type = 'button';
    button.setAttribute('aria-label', 'Rotate selection (drag)');
    button.appendChild(makeBidirectionalRotateIcon());
    return button;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function defaultViewportSize(): { width: number; height: number } {
    return {
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
    };
}

export function createRotateHandle(
    options: RotateHandleOptions,
): RotateHandleHandle {
    const {
        container,
        rotationFocus,
        getFocusedGroupScreenBounds,
        getViewportSize = defaultViewportSize,
    } = options;

    let shown = false;
    let active: ActiveHandle | null = null;
    let unsubscribeFocus: (() => void) | null = null;

    function placeButton(button: HTMLButtonElement, leftPx: number, topPx: number): void {
        button.style.left = `${leftPx}px`;
        button.style.top = `${topPx}px`;
    }

    function spawn(groupId: number): void {
        const bounds = getFocusedGroupScreenBounds(groupId);
        if (!bounds) return;
        const viewport = getViewportSize();

        const button = makeButton();

        const naturalLeft = (bounds.left + bounds.right) / 2 - BUTTON_SIZE_PX / 2;
        const naturalTop = bounds.bottom + BUTTON_GAP_PX;

        const maxLeft = viewport.width - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;
        const maxTop = viewport.height - BUTTON_SIZE_PX - VIEWPORT_MARGIN_PX;

        placeButton(
            button,
            clamp(naturalLeft, VIEWPORT_MARGIN_PX, maxLeft),
            clamp(naturalTop, VIEWPORT_MARGIN_PX, maxTop),
        );

        container.appendChild(button);

        // Force a reflow so the browser registers the base-rule opacity:0
        // before the fade-in class lands (mirrors rotate-buttons.ts).
        void button.offsetHeight;
        button.classList.add('rotate-handle--fade-in');

        active = {
            groupId,
            button,
            idleTimerId: null,
            removalTimerId: null,
            transitionEndListener: null,
            state: 'visible',
        };
        startIdleTimer();
    }

    function rescueActive(): void {
        if (!active) return;
        cancelRemoval(active);
        if (active.idleTimerId !== null) {
            clearTimeout(active.idleTimerId);
            active.idleTimerId = null;
        }
        active.button.classList.remove('rotate-handle--fade-out-slow', 'rotate-handle--fade-out-quick');
        active.button.classList.add('rotate-handle--fade-in');
        active.state = 'visible';
    }

    function startIdleTimer(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        active.idleTimerId = setTimeout(startSlowFadeOut, IDLE_TIMEOUT_MS);
    }

    function clearIdleTimer(): void {
        if (active && active.idleTimerId !== null) {
            clearTimeout(active.idleTimerId);
            active.idleTimerId = null;
        }
    }

    function startSlowFadeOut(): void {
        if (!active) return;
        clearIdleTimer();
        active.state = 'fade-out-slow';
        active.button.classList.remove('rotate-handle--fade-in');
        active.button.classList.add('rotate-handle--fade-out-slow');
        scheduleRemoval(active, SLOW_FADE_MS, /* clearFocusOnRemove */ true);
    }

    function startQuickFadeOut(handle: ActiveHandle): void {
        cancelRemoval(handle);
        if (handle.idleTimerId !== null) {
            clearTimeout(handle.idleTimerId);
            handle.idleTimerId = null;
        }
        handle.state = 'fade-out-quick';
        handle.button.classList.remove('rotate-handle--fade-in', 'rotate-handle--fade-out-slow');
        handle.button.classList.add('rotate-handle--fade-out-quick');
        scheduleRemoval(handle, QUICK_FADE_MS, /* clearFocusOnRemove */ false);
    }

    function scheduleRemoval(
        handle: ActiveHandle,
        fallbackMs: number,
        clearFocusOnRemove: boolean,
    ): void {
        const onEnd = () => {
            if (handle.removalTimerId !== null) {
                clearTimeout(handle.removalTimerId);
                handle.removalTimerId = null;
            }
            handle.transitionEndListener = null;
            handle.button.removeEventListener('transitionend', onEnd);
            handle.button.remove();
            if (active === handle) active = null;
            if (clearFocusOnRemove) rotationFocus.clearFocus();
        };
        handle.transitionEndListener = onEnd;
        handle.button.addEventListener('transitionend', onEnd);
        handle.removalTimerId = setTimeout(onEnd, fallbackMs + 100);
    }

    function cancelRemoval(handle: ActiveHandle): void {
        if (handle.removalTimerId !== null) {
            clearTimeout(handle.removalTimerId);
            handle.removalTimerId = null;
        }
        if (handle.transitionEndListener !== null) {
            handle.button.removeEventListener('transitionend', handle.transitionEndListener);
            handle.transitionEndListener = null;
        }
    }

    function teardownActive(): void {
        if (!active) return;
        if (active.idleTimerId !== null) clearTimeout(active.idleTimerId);
        if (active.removalTimerId !== null) clearTimeout(active.removalTimerId);
        if (active.transitionEndListener !== null) {
            active.button.removeEventListener('transitionend', active.transitionEndListener);
        }
        active.button.remove();
        active = null;
    }

    function handleFocusChange(focusedGroupId: number | null): void {
        if (!shown) return;
        if (focusedGroupId === null) {
            if (active) startQuickFadeOut(active);
            return;
        }
        if (active && active.groupId === focusedGroupId) {
            if (active.state !== 'visible') {
                rescueActive();
                startIdleTimer();
            }
            return;
        }
        if (active) {
            const old = active;
            active = null;
            startQuickFadeOut(old);
        }
        spawn(focusedGroupId);
    }

    return {
        show() {
            if (shown) return;
            shown = true;
            unsubscribeFocus = rotationFocus.onChange(handleFocusChange);
            if (rotationFocus.focusedGroupId !== null) {
                spawn(rotationFocus.focusedGroupId);
            }
        },
        hide() {
            if (!shown) return;
            shown = false;
            if (unsubscribeFocus) {
                unsubscribeFocus();
                unsubscribeFocus = null;
            }
            teardownActive();
        },
        destroy() {
            if (unsubscribeFocus) {
                unsubscribeFocus();
                unsubscribeFocus = null;
            }
            shown = false;
            teardownActive();
        },
    };
}
```

- [ ] **Step 2: Add CSS in `style.css`**

Use the existing `.rotate-button` rules as a template; key adjustments are `border-radius: 50%`, single button (no `--cw` / `--ccw` modifiers):

```css
/* Free-rotation drag handle — single round button. Mirrors the
   .rotate-button fade lifecycle but with circular geometry. */
.rotate-handle {
    position: fixed;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    /* match the .rotate-button background, padding, box-shadow, etc. — copy
       from the existing rule and remove anything inherent to the rectangular
       look (border-radius small values, side-specific shadow) */
    /* base state: invisible until --fade-in lands */
    opacity: 0;
    transition: opacity 100ms ease-out;
    pointer-events: auto;
    /* z-index above the puzzle but below modals (mirror .rotate-button) */
}

.rotate-handle--fade-in {
    opacity: 1;
}

.rotate-handle--fade-out-slow {
    opacity: 0;
    transition: opacity 750ms ease-in;
}

.rotate-handle--fade-out-quick {
    opacity: 0;
    transition: opacity 100ms ease-out;
    pointer-events: none;
}
```

(Cross-check the existing `.rotate-button` base rule for shadow / palette / padding values; copy those over so the visual weight matches the toolbar.)

- [ ] **Step 3: Re-export from the UI barrel**

In `src/ui/index.ts`:

```ts
export { createRotateHandle, type RotateHandleHandle, type RotateHandleOptions } from './rotate-handle.js';
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: clean build (no test for the scaffolding yet — added in Task 11 with the gesture).

- [ ] **Step 5: Commit**

```bash
git add src/ui/rotate-handle.ts src/ui/index.ts src/style.css
git commit -m "$(cat <<'EOF'
feat(rotate-handle): scaffold lifecycle and visuals

Single round 44px button with bidirectional rotate icon, mirroring
the rotate-buttons fade-in/idle-timeout/quick-fade lifecycle.
Gesture math arrives in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Gesture math for `rotate-handle`

**Files:**
- Modify: `src/ui/rotate-handle.ts`
- Test: `src/ui/rotate-handle.test.ts`

The gesture is: at `pointerdown`, capture the pivot world position `P` (group bbox centre), the pointer's world position `Q₀`, the group's current rotation `R₀`, and the angle `θ₀ = atan2(Q₀ − P)`. On each `pointermove`, compute `θ = atan2(Q − P)` and emit `onRotate(groupId, R₀ + (θ − θ₀)·180/π − currentRotation)`. On `pointerup`, emit `onCommit`. On any new `pointerdown` while drag is active, cancel.

- [ ] **Step 1: Extend `RotateHandleOptions` with the math hooks**

Add to the options:

```ts
export interface RotateHandleOptions {
    // ...existing...
    /** Current rotation of the focused group, in degrees. */
    getGroupRotation: (groupId: number) => number | null;
    /** World position of the focused group's bbox centre. */
    getGroupPivotWorld: (groupId: number) => { x: number; y: number } | null;
    /** Convert a screen-space (clientX, clientY) point to world coordinates. */
    screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
}
```

- [ ] **Step 2: Wire pointer handlers on the spawned button**

Inside `spawn(groupId)`, after the `container.appendChild(button)` line, attach drag handlers:

```ts
let drag: {
    pivot: { x: number; y: number };
    initialRotation: number;
    initialAngleRad: number;
    pointerId: number;
    extraPointerListener: (e: PointerEvent) => void;
} | null = null;

button.addEventListener('pointerdown', (event) => {
    if (drag !== null) return;
    const pivot = options.getGroupPivotWorld(groupId);
    const initialRotation = options.getGroupRotation(groupId);
    if (!pivot || initialRotation === null) return;

    const Q0 = options.screenToWorld(event.clientX, event.clientY);
    const initialAngleRad = Math.atan2(Q0.y - pivot.y, Q0.x - pivot.x);

    button.setPointerCapture(event.pointerId);

    // Multi-finger cancel: any subsequent pointerdown anywhere on
    // window kills the rotation drag.
    const extraPointerListener = (e: PointerEvent): void => {
        if (e.pointerId === event.pointerId) return;
        cancelDrag();
    };
    window.addEventListener('pointerdown', extraPointerListener, { capture: true });

    drag = {
        pivot,
        initialRotation,
        initialAngleRad,
        pointerId: event.pointerId,
        extraPointerListener,
    };

    if (active && active.state !== 'visible') rescueActive();
    clearIdleTimer();
    event.preventDefault();
});

button.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const Q = options.screenToWorld(event.clientX, event.clientY);
    const angleRad = Math.atan2(Q.y - drag.pivot.y, Q.x - drag.pivot.x);
    const deltaDeg = ((angleRad - drag.initialAngleRad) * 180) / Math.PI;
    const targetRotation = drag.initialRotation + deltaDeg;
    const currentRotation = options.getGroupRotation(groupId);
    if (currentRotation === null) return;
    options.onRotate(groupId, targetRotation - currentRotation);
});

button.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finalizeDrag(/* commit */ true);
});

button.addEventListener('pointercancel', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finalizeDrag(/* commit */ false);
});

function cancelDrag(): void {
    finalizeDrag(/* commit */ false);
}

function finalizeDrag(commit: boolean): void {
    if (!drag) return;
    if (button.hasPointerCapture(drag.pointerId)) {
        button.releasePointerCapture(drag.pointerId);
    }
    window.removeEventListener('pointerdown', drag.extraPointerListener, { capture: true } as EventListenerOptions);
    drag = null;
    if (commit) options.onCommit(groupId);
    startIdleTimer();
}
```

(`drag` and `cancelDrag` need to be in scope within `spawn`'s closure; the snippet above places them in the right place. If lint complains about the function-before-declaration order, hoist `cancelDrag`/`finalizeDrag` to function declarations within `spawn`'s body.)

- [ ] **Step 3: Write gesture-math tests**

Create `src/ui/rotate-handle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RotationFocus } from '../interaction/rotation-focus.js';
import { createRotateHandle } from './rotate-handle.js';

describe('rotate-handle gesture', () => {
    let container: HTMLElement;
    let rotationFocus: RotationFocus;
    let onRotate: ReturnType<typeof vi.fn>;
    let onCommit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement('div');
        document.body.appendChild(container);
        rotationFocus = new RotationFocus();
        onRotate = vi.fn();
        onCommit = vi.fn();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    function makeHandle(opts: Partial<Parameters<typeof createRotateHandle>[0]> = {}): ReturnType<typeof createRotateHandle> {
        return createRotateHandle({
            container,
            rotationFocus,
            onRotate,
            onCommit,
            getFocusedGroupScreenBounds: () => ({ left: 100, right: 200, top: 100, bottom: 200 }),
            getViewportSize: () => ({ width: 800, height: 600 }),
            getGroupRotation: () => 0,
            getGroupPivotWorld: () => ({ x: 150, y: 150 }),
            screenToWorld: (cx, cy) => ({ x: cx, y: cy }),     // identity for these tests
            ...opts,
        });
    }

    function dispatchPointerEvent(target: EventTarget, type: string, init: Partial<PointerEventInit>): void {
        const evt = new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
        target.dispatchEvent(evt);
    }

    it('emits onRotate with a delta proportional to the angular change', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(/* groupId */ 0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;

        // Pointer starts at (250, 150) — pivot is (150,150), so angle = 0.
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        // Move to (150, 250) — angle = 90° clockwise.
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });

        expect(onRotate).toHaveBeenCalled();
        const lastCall = onRotate.mock.calls.at(-1)!;
        expect(lastCall[0]).toBe(0);
        // Delta from current (0) to target (90) is 90°.
        expect(lastCall[1]).toBeCloseTo(90, 0);

        handle.destroy();
    });

    it('calls onCommit on pointerup', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        dispatchPointerEvent(button, 'pointerup', { clientX: 150, clientY: 250 });

        expect(onCommit).toHaveBeenCalledWith(0);

        handle.destroy();
    });

    it('cancels (no onCommit) when a second pointer lands on window', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });

        // Second finger lands somewhere else.
        const secondFinger = new PointerEvent('pointerdown', {
            pointerId: 2, bubbles: true, clientX: 500, clientY: 500,
        });
        window.dispatchEvent(secondFinger);

        // Subsequent pointermove on the original finger should NOT emit onRotate.
        onRotate.mockClear();
        dispatchPointerEvent(button, 'pointermove', { clientX: 150, clientY: 250 });
        expect(onRotate).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();

        handle.destroy();
    });
});
```

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/ui/rotate-handle.test.ts
```

If any test fails, the most common reason is jsdom's `PointerEvent` polyfill missing fields the implementation reads. Inspect the assertion and adjust either the test or implementation.

- [ ] **Step 5: Commit**

```bash
git add src/ui/rotate-handle.ts src/ui/rotate-handle.test.ts
git commit -m "$(cat <<'EOF'
feat(rotate-handle): add drag-rotation gesture math

pointerdown captures the world-space pivot, pointer angle, and
group rotation. pointermove emits onRotate with the angular delta,
keeping the pointer-to-pivot angle constant. pointerup calls
onCommit; any second pointerdown anywhere on window cancels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Mode-aware UI swap in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Create the rotate-handle alongside rotate-buttons**

In `src/main.ts`, near the existing `createRotateButtons` block:

```ts
import { createRotateHandle } from './ui/index.js';
import { rotateGroup } from './game/rotate-group.js';
import { getGroupLocalBounds } from './game/index.js';
import { localToWorld } from './model/helpers.js';

// ...existing code that creates rotateButtons...

const rotateHandle = createRotateHandle({
    container: app,
    rotationFocus,
    onRotate: (groupId, deltaDegrees) => {
        if (!gameState) return;
        const group = gameState.groupsById.get(groupId);
        if (!group) return;
        rotateGroup(group, gameState.piecesById, deltaDegrees);
        renderer.renderState(gameState);
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
    },
    onCommit: (groupId) => {
        if (!gameState) return;
        // Run merge detection on the freshly-rotated group.
        const tolerance = getActiveTolerance(
            gameState.imageSize.width,
            gameState.gridSize.cols,
            gameState.cutStyle,
        );
        const result = processDrop(groupId, gameState, tolerance);
        if (result) {
            renderer.renderState(gameState);
            renderer.flashMergePulse(result.group.id);
            // (Mirror the post-merge selection / cascade / completion handling
            // from the existing onDrop handler — pull that out into a small
            // helper if it duplicates more than ~10 lines.)
        }
        autoSave();
    },
    getFocusedGroupScreenBounds,
    getGroupRotation: (groupId) => gameState?.groupsById.get(groupId)?.rotation ?? null,
    getGroupPivotWorld: (groupId) => {
        const group = gameState?.groupsById.get(groupId);
        if (!group || !gameState) return null;
        const bounds = getGroupLocalBounds(group, gameState.piecesById);
        const centreLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        return localToWorld(centreLocal, group);
    },
    screenToWorld: (clientX, clientY) => viewportTransform.screenToWorld({ x: clientX, y: clientY }),
});
```

- [ ] **Step 2: Update `updateRotateButtonsVisibility`**

Rename to `updateRotationUiVisibility` and add the new mode:

```ts
function updateRotationUiVisibility(): void {
    if (gameState?.rotationMode === 'quarter-turn') {
        rotateButtons.show();
        rotateHandle.hide();
    } else if (gameState?.rotationMode === 'free') {
        rotateButtons.hide();
        rotateHandle.show();
    } else {
        rotateButtons.hide();
        rotateHandle.hide();
    }
}
```

Update the call site in `initGame`. Find the `updateRotateButtonsVisibility()` reference and rename it.

- [ ] **Step 3: Build and run all tests**

```bash
npm run build
npm test
```

Expected: clean build, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(main): mode-aware rotation UI swap

Quarter-turn mode shows the existing CCW/CW button pair; free mode
shows the new round drag handle; 'none' shows neither.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update help text per `CLAUDE.md`

**Files:**
- Modify: `src/ui/info-modal.ts`
- Test: `src/ui/info-modal.test.ts`

Per the project's CLAUDE.md, the info modal is the only in-app help surface, so the **How to Play**, **Cut Styles**, and **Settings** sections must be updated.

- [ ] **Step 1: Inspect the modal**

```bash
grep -n "rotation\|How to Play\|Cut Styles\|Settings" src/ui/info-modal.ts | head -40
```

Identify where the existing rotation copy lives. Per the recent commit history, it was generalised in `c7dc8a0` and is keyed off cut style; you'll likely add a free-rotation paragraph in **How to Play** and a sentence under composable in **Cut Styles**.

- [ ] **Step 2: Add free-rotation copy**

In **How to Play**, after the existing rotation paragraph:

```
When you start a new game with **Free rotation** turned on (composable
puzzles only), the toolbar shows a single round handle below the focused
piece-group. Drag that handle to rotate the group continuously — the
angle from your finger to the group's centre stays fixed, so the group
"follows" your finger like a dial. Pieces only need to be within about
10° of perfect alignment to merge with their neighbours; a second touch
on the canvas cancels the rotation.
```

In **Cut Styles** under composable:

```
Composable puzzles can also be played with **Free rotation** — see
*How to Play* for the gesture.
```

In **Settings** (if the modal documents the new-game dialog options):

```
**Free rotation** (sub-option, composable only): when on, groups rotate
to any angle instead of the four quarter-turns.
```

- [ ] **Step 3: Update the modal tests**

In `src/ui/info-modal.test.ts`, add an assertion that the rendered modal contains the substring "Free rotation" when the appropriate state is exercised.

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/ui/info-modal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "$(cat <<'EOF'
docs(info-modal): describe free rotation and the drag handle

Per CLAUDE.md: the info modal is the only in-app help surface,
so user-visible features must be reflected there in the same PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Browser sanity check

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manual checks**

1. Open the New Game dialog. Verify the "Free rotation" sub-checkbox is hidden by default. Tick "Enable rotation" → it appears. Switch cut style to fractal or classic → it hides. Switch back to composable → it reappears.
2. Tick the sub-checkbox, start a composable puzzle. Verify groups start at random non-quarter-turn angles. Verify the round drag handle (single, bidirectional icon) appears below the tapped group, not the existing CCW/CW buttons.
3. Drag the handle in a circle around the group's centre. The group rotates continuously, with the pointer staying on a fixed angular ray from the pivot. Release in the middle of empty table — group keeps the angle.
4. Find two mate pieces, get them positionally close, rotate them to within ±10° of each other, drop. They merge with rotation snapping to the target's angle and position snapping into perfect alignment.
5. Rotate two unrelated pieces and drop near each other — no merge.
6. Two-finger pinch while rotation drag is active → rotation cancels, pinch zoom works normally.
7. Reload the page → save/restore preserves the free-rotation angles. Verify by inspecting `localStorage`'s `puzzle-state` value if needed.
8. Generate a share link from a partially-merged free-rotation puzzle → open in a private window → loads correctly.
9. Sanity check: start a quarter-turn puzzle. CCW/CW buttons appear (not the handle); behaviour identical to before.

If any check fails, bisect through the commits.

- [ ] **Step 3: Stop dev server, no commit needed.**

---

## Task 15: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(rotation): add free rotation for composable puzzles" --body "$(cat <<'EOF'
## Summary

- New `rotationMode: 'free'` for composable puzzles only, gated on a
  sub-checkbox under "Enable rotation" in the new-game dialog.
- New round drag-handle component replaces the CCW/CW button pair in
  free mode. The angle from the group's bbox-centre to the pointer
  stays constant during the drag, so the group "follows" the finger.
- Merge detection tolerates ±10° angular misalignment; on merge, both
  rotation and position snap to the target group's frame.
- Save format and share-link encoding handle integer-degrees encoding
  for free-mode puzzles. Existing v: 1 share links keep their
  quarter-turn semantics; the schema is unchanged.
- Help text updated in info-modal per CLAUDE.md.

Closes #<issue-number-if-any>.

## Test plan

- [ ] `npm test` — all green.
- [ ] Free-rotation composable puzzle: drag handle rotates group continuously.
- [ ] Free-rotation merge tolerance feels reasonable at 10° (subjective; tune later if needed).
- [ ] 2nd finger cancels rotation drag without rolling back the angle.
- [ ] Save + reload preserves angles.
- [ ] Share link round-trips a partially-solved free-rotation puzzle.
- [ ] Quarter-turn mode unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.
