# Piece-Anchored Snap Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make big groups merge (and the snap-proximity assists engage) when a mated edge is visually flush, by anchoring the rotation-snap pivot on the mated piece instead of the group bbox center — spec: `docs/superpowers/specs/2026-08-08-snap-piece-anchored-pivot-design.md`, issue #530.

**Architecture:** `measureEdgeAlignment` simulates the rotation snap around the moved candidate piece's center (was: moved group's bbox center), `mergeGroups` applies the real snap around the same pivot so `snapDelta` stays exact, and `computeSnapProximityRotation` returns the winning candidate's pivot for the controller to rotate around (follow-the-winner). Single-piece groups are bit-for-bit unaffected (piece center = group bbox center), which existing tests exploit as the regression anchor.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- Comment policy (repo `CLAUDE.md`): only intent (5) / not-in-code contracts (6). A comment falsified by a change is deleted unless clearly worth rewriting. Never add summary/marker/how comments.
- American English in all code and comments.
- Test placement: tests live next to the source they test; shared fixtures in `src/test-helpers/fixtures.ts`.
- No PRNG calls anywhere in this change (share-link reproducibility contract untouched); no generator/geometry changes (the dcel digest tripwire must stay green untouched — do not run `vitest -u`).
- Free-rotation mode only: quarter-turn merges have rotation delta 0, so the snap context short-circuits to `null` and the pivot is never used. No behavior change outside free mode.
- Work on a feature branch; repo merges via rebase-and-merge; push and open the PR without asking.
- Verification commands: `npm test`, `npm run build`, `npm run lint`.

---

### Task 1: Piece-anchored measurement (`merge-detection.ts`)

**Files:**
- Modify: `src/game/merge-detection.ts`
- Modify: `src/game/snap-proximity-rotation.ts:71-75` (call site only)
- Modify: `src/game/snap-proximity-position.ts:58-62` (call site only)
- Modify: `src/test-helpers/fixtures.ts` (new scenario fixture)
- Test: `src/game/merge-detection.test.ts`

**Interfaces:**
- Consumes: existing `Piece.bounds: PieceBounds`, `PieceGroup.pieces: Map<number, Point>`, `localToWorld`, `signedAngularDelta`, `rotatePoint` from `src/model/helpers.ts`.
- Produces (later tasks rely on these exact signatures):
  - `export function pieceCenterLocal(group: PieceGroup, piece: Piece): Point` in `src/game/merge-detection.ts` — the piece's center in un-rotated group-local space (group piece offset + `piece.bounds` center); throws if the piece is not in the group.
  - `export function measureEdgeAlignment(movedPiece: Piece, movedEdge: Edge, movedGroup: PieceGroup, targetPiece: Piece, targetEdge: Edge, targetGroup: PieceGroup): EdgeAlignmentMeasurement` — the `piecesById` and `movedCenterLocal` parameters are REMOVED.
  - `export function checkEdgeAlignment(movedPiece: Piece, movedEdge: Edge, movedGroup: PieceGroup, targetPiece: Piece, targetEdge: Edge, targetGroup: PieceGroup, tolerance?: number, rotationTolerance?: number)` — `piecesById` REMOVED.
  - `makeWideRowScenario(rotationDeg: number)` in `src/test-helpers/fixtures.ts` (shape below).

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/piece-anchored-snap-pivot
```

- [ ] **Step 2: Add the wide-row scenario fixture**

In `src/test-helpers/fixtures.ts` (it already imports `rotatePoint` and the model types; extend imports if a type is missing). The doc comment is category 6 — it records the geometry the fixture pins, which the numbers alone can't express:

```ts
/**
 * The issue-#530 scenario: a stationary single-piece target (piece 0,
 * group 10, at the origin) and a five-piece 500×100 moved row (pieces
 * 1–5, group 11) rotated `rotationDeg`, positioned so piece 1's center
 * sits exactly at its aligned world position (150, 50). Piece 1 is the
 * row's only mated piece and sits 200 px from the row's bbox center, so
 * at 8° a group-center-pivot rotation snap sweeps its edge ≈ 27.9 px
 * (2·200·sin 4°) — past MERGE_TOLERANCE_PX — while a piece-center pivot
 * measures ≈ 0.
 */
export function makeWideRowScenario(rotationDeg: number): {
    state: GameState;
    movedGroup: PieceGroup;
    targetGroup: PieceGroup;
    piece0: Piece;
    piece1: Piece;
} {
    const { piece0, piece1 } = makeMatedPiecePair();
    const edge = (id: number, start: Point, end: Point): Edge =>
        ({ id, matePieceId: -1, mateEdgeId: -1, path: '', start, end });
    const fillers = [2, 3, 4, 5].map((id) => makePiece({ id, edges: [
        edge(id * 10, { x: 0, y: 0 }, { x: 100, y: 0 }),
        edge(id * 10 + 1, { x: 100, y: 0 }, { x: 100, y: 100 }),
        edge(id * 10 + 2, { x: 100, y: 100 }, { x: 0, y: 100 }),
        edge(id * 10 + 3, { x: 0, y: 100 }, { x: 0, y: 0 }),
    ] }));
    const r = rotatePoint({ x: 50, y: 50 }, rotationDeg);
    const movedGroup: PieceGroup = {
        id: 11,
        pieces: new Map([
            [1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }], [3, { x: 200, y: 0 }],
            [4, { x: 300, y: 0 }], [5, { x: 400, y: 0 }],
        ]),
        position: { x: 150 - r.x, y: 50 - r.y },
        rotation: rotationDeg,
    };
    const targetGroup: PieceGroup = {
        id: 10,
        pieces: new Map([[0, { x: 0, y: 0 }]]),
        position: { x: 0, y: 0 },
        rotation: 0,
    };
    const state = makeGameState({
        pieces: [piece0, piece1, ...fillers],
        groups: [targetGroup, movedGroup],
        rotationMode: 'free',
    });
    return { state, movedGroup, targetGroup, piece0, piece1 };
}
```

Notes: the fillers are border-only pieces riding in the same group — `getBorderEdges` finds exactly one cross-group candidate (piece 1's edge id 1 ↔ piece 0's edge id 0, which is `piece1.edges[3]` ↔ `piece0.edges[1]`). Filler edge ids 20–53 don't collide with the mated pair's ids (0, 1, 10–15).

- [ ] **Step 3: Write the failing tests**

Append to `src/game/merge-detection.test.ts` (add `makeWideRowScenario` to the fixtures import):

```ts
describe('piece-anchored rotation snap pivot (issue #530)', () => {
    it('measures a flush edge on a wide group as flush, regardless of group size', () => {
        const { movedGroup, targetGroup, piece0, piece1 } = makeWideRowScenario(8);

        const m = measureEdgeAlignment(
            piece1, piece1.edges[3], movedGroup,
            piece0, piece0.edges[1], targetGroup,
        );

        expect(m.rotationDelta).toBeCloseTo(-8);
        expect(m.distance).toBeCloseTo(0, 6);
    });

    it('accepts the wide-group flush edge within default tolerances', () => {
        const { movedGroup, targetGroup, piece0, piece1 } = makeWideRowScenario(8);

        const result = checkEdgeAlignment(
            piece1, piece1.edges[3], movedGroup,
            piece0, piece0.edges[1], targetGroup,
        );

        expect(result.aligned).toBe(true);
    });
});
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npx vitest run src/game/merge-detection.test.ts`
Expected: the two new tests FAIL — compile-level argument-count mismatch is the acceptable failure mode here; if run against the old signature with `state.piecesById` inserted, they fail with `distance` ≈ 27.9 and `aligned: false`. Existing tests still pass.

- [ ] **Step 5: Implement the piece-anchored measurement**

In `src/game/merge-detection.ts`:

1. Add and export `pieceCenterLocal`:

```ts
export function pieceCenterLocal(group: PieceGroup, piece: Piece): Point {
    const offset = group.pieces.get(piece.id);
    if (!offset) throw new Error(`Piece ${piece.id} not in group ${group.id}`);
    return {
        x: offset.x + (piece.bounds.minX + piece.bounds.maxX) / 2,
        y: offset.y + (piece.bounds.minY + piece.bounds.maxY) / 2,
    };
}
```

2. Rework `RotationSnapContext` / `buildRotationSnapContext` — the pivot is now passed in, so the `piecesById` bounds traversal goes away entirely. Rename fields `centerLocal` → `pivotLocal` and `worldCenter` → `worldPivot`:

```ts
interface RotationSnapContext {
    /** Rotation pivot in un-rotated group-local space — the moved candidate piece's center. */
    pivotLocal: Point;
    /** World-space pivot, fixed during the snap. */
    worldPivot: Point;
    /** Group rotation after applying the snap delta, normalized to [0, 360). */
    newRotation: number;
}

function buildRotationSnapContext(
    group: PieceGroup,
    extraDeg: number,
    pivotLocal: Point,
): RotationSnapContext | null {
    if (Math.abs(extraDeg) < SNAP_EPSILON_DEG) return null;
    return {
        pivotLocal,
        worldPivot: localToWorld(pivotLocal, group),
        newRotation: normalizeDegrees(group.rotation + extraDeg),
    };
}
```

3. Update `getWorldPositionAfterRotationSnap` to the renamed fields (`snapCtx.pivotLocal`, `snapCtx.worldPivot`); its logic is otherwise unchanged. Its doc comment's "around its bbox center — the way `rotateGroup` performs a rotation snap" becomes "around the given pivot — the way `rotateGroup` performs a rotation snap".

4. Change `measureEdgeAlignment` — drop the `piecesById` and `movedCenterLocal` parameters, derive the pivot from the moved piece:

```ts
export function measureEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
): EdgeAlignmentMeasurement {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);

    const snapCtx = buildRotationSnapContext(
        movedGroup, rotDelta, pieceCenterLocal(movedGroup, movedPiece),
    );
    // ... rest unchanged
```

Replace the doc comment's last paragraph (the `movedCenterLocal` performance note — its subject is gone) with the pivot contract, which is category 6 (the cross-module consistency requirement the types can't express):

```
The simulated snap pivots on the MOVED PIECE's center, not the group's
bbox center, so a flush edge measures flush no matter how large the
group is (issue #530). `mergeGroups` must apply the real snap around
the same pivot or `snapDelta` lands the group elsewhere.
```

5. Change `checkEdgeAlignment` — drop its `piecesById` parameter and stop forwarding it; `tolerance`/`rotationTolerance` shift one position left. Update `detectMerges`'s call accordingly.

6. Remove the now-unused `getGroupLocalBounds` import (and `Point` if it becomes unused — it does not; `pieceCenterLocal` returns one).

7. Update the two assist call sites to the new signature — in `src/game/snap-proximity-rotation.ts` and `src/game/snap-proximity-position.ts`, the call becomes:

```ts
const m = measureEdgeAlignment(
    candidate.piece, candidate.edge, group,
    candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
);
```

(`ctx.centerLocal` stays in `ProximityContext` for now — the rotation controller still uses it as its pivot until Task 3.)

8. In `src/game/snap-proximity-position.ts`, delete the header sentence claiming distance is invariant to the player's rotation ("The rotation gesture pivots on the group's bbox center and `distance` is measured after simulating the rotation snap, so `distance` is invariant to the player's rotation — it responds only to the translation applied here."). With a piece-anchored measurement the player's bbox-center rotation gesture moves the piece center, so the claim is false; the ratchet stays one-way because corrections only ever shrink `d` to the cap, and at θ = 0 the cap is 0 so the full snap still lands. Replace the sentence with:

```
Corrections only ever shrink the measured distance toward the cap, and
at θ = 0 the cap is 0, so the full merge correction lands there.
```

- [ ] **Step 6: Update existing merge-detection tests to the new signatures**

In `src/game/merge-detection.test.ts`:
- Remove the `piecesById` argument (`new Map()` / `state.piecesById`) from every `checkEdgeAlignment` / `measureEdgeAlignment` call; where a tolerance was passed after it, the tolerance moves up one position.
- Delete the test `'a precomputed movedCenterLocal yields identical measurements'` (line ~483) — its subject parameter no longer exists.
- Remove the `getGroupLocalBounds` import if it was only used by that test.

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/game/merge-detection.test.ts src/game/snap-proximity-rotation.test.ts src/game/snap-proximity-position.test.ts src/game/group-merging.test.ts`
Expected: ALL PASS. (Every existing moved group in these suites is single-piece, where the piece center equals the group bbox center — this is the regression anchor from the spec.)

- [ ] **Step 8: Commit**

```bash
git add src/game/merge-detection.ts src/game/merge-detection.test.ts src/game/snap-proximity-rotation.ts src/game/snap-proximity-position.ts src/test-helpers/fixtures.ts
git commit -m "feat(snap): measure edge alignment around the mated piece's center

On a large group a flush edge measured ~group-radius × θ away, because
the simulated rotation snap pivoted on the group bbox center. Anchoring
the pivot on the mated piece makes the measurement independent of group
size. Single-piece groups are unaffected (piece center = bbox center).

Part of #530.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa"
```

---

### Task 2: Merge application pivots on the mated piece (`group-merging.ts`, `rotate-group.ts`)

**Files:**
- Modify: `src/game/group-merging.ts:28-68` (`mergeGroups`), `:99-137` (`processDrop` call site)
- Modify: `src/game/rotate-group.ts` (parameter rename + doc)
- Test: `src/game/group-merging.test.ts`

**Interfaces:**
- Consumes: `pieceCenterLocal(group, piece)` from Task 1; `detectMerges` (unchanged signature); `MergeCandidate.movedPiece`.
- Produces:
  - `export function mergeGroups(state: GameState, movedGroup: PieceGroup, targetGroup: PieceGroup, snapDelta: Point, movedPiece: Piece): PieceGroup` — new required 5th parameter; the pivot is computed lazily, only when the rotation delta exceeds `SNAP_EPSILON_DEG`.
  - `rotateGroup(group, piecesById, deltaDegrees, pivotLocal?)` — 4th parameter renamed from `precomputedCenterLocal` to `pivotLocal`; same default (bbox center, computed from `piecesById` when omitted).

- [ ] **Step 1: Write the failing tests**

Append to `src/game/group-merging.test.ts` (import `makeWideRowScenario` from fixtures and `getWorldPosition` from `../model/helpers.js` if not already imported):

```ts
describe('piece-anchored merge pivot (issue #530)', () => {
    it('pivots the rotation snap on the moved piece, keeping its center fixed', () => {
        const { state, movedGroup, targetGroup, piece1 } = makeWideRowScenario(8);
        const before = getWorldPosition({ x: 50, y: 50 }, 1, movedGroup);

        mergeGroups(state, movedGroup, targetGroup, { x: 0, y: 0 }, piece1);

        const after = getWorldPosition({ x: 50, y: 50 }, 1, targetGroup);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });

    it('processDrop merges a wide group flush at one piece into exact alignment', () => {
        const { state, piece0, piece1 } = makeWideRowScenario(8);

        const result = processDrop(11, state);

        expect(result).not.toBeNull();
        expect(result!.group.pieces.size).toBe(6);
        // Mate endpoints coincide exactly after the merge (mate edges run in
        // opposite directions: moved start ↔ target end).
        const movedStart = getWorldPosition(piece1.edges[3].start, 1, result!.group);
        const targetEnd = getWorldPosition(piece0.edges[1].end, 0, result!.group);
        expect(movedStart.x).toBeCloseTo(targetEnd.x);
        expect(movedStart.y).toBeCloseTo(targetEnd.y);
    });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/game/group-merging.test.ts`
Expected: FAIL — first test on argument count (or, with the old 4-arg call, piece 1's center moves ≈ 27.9 px); second test finds the merge (Task 1 made detection accept it) but the endpoints land ≈ 27.9 px apart because `mergeGroups` still pivots on the group bbox center.

- [ ] **Step 3: Implement the piece pivot in mergeGroups and processDrop**

In `src/game/group-merging.ts` — add `movedPiece: Piece` as the 5th parameter (import `Piece` type and `pieceCenterLocal`), and pass the pivot to `rotateGroup`:

```ts
export function mergeGroups(
    state: GameState,
    movedGroup: PieceGroup,
    targetGroup: PieceGroup,
    snapDelta: Point,
    movedPiece: Piece,
): PieceGroup {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > SNAP_EPSILON_DEG) {
        rotateGroup(
            movedGroup, state.piecesById, rotDelta,
            pieceCenterLocal(movedGroup, movedPiece),
        );
    }
    // ... rest unchanged
```

Rewrite the comment above the rotation snap (currently "The pivot is the moved group's bbox center (rotateGroup's invariant) — the snapDelta returned by merge-detection was computed assuming this snap would happen first."):

```
// Snap the moved group's rotation to the target's first, pivoting on
// the mated piece's center — the same pivot measureEdgeAlignment
// simulated, so the snapDelta below lands the group exactly.
//
// For quarter-turn merges the delta is always 0, so this is a no-op
// and behavior is unchanged for classic/composable rotation modes.
```

In `processDrop`, the call becomes:

```ts
mergeGroups(state, best.movedGroup, best.targetGroup, best.snapDelta, best.movedPiece);
```

- [ ] **Step 4: Rename rotateGroup's pivot parameter**

In `src/game/rotate-group.ts`: rename `precomputedCenterLocal` → `pivotLocal` (both signature and body). Update its doc comment: the function keeps the given local pivot fixed in world space, defaulting to the group's bbox center (computed from `piecesById`) when omitted; the pivot must be expressed in un-rotated group-local space. Delete the sentence "It must match the group's current composition." only if it no longer applies — it still does for the default path, so instead generalize: callers passing a pivot choose which local point stays anchored. Callers passing positionally (`rotate-group.test.ts:193`, controller until Task 3) need no change.

- [ ] **Step 5: Update existing mergeGroups test call sites**

In `src/game/group-merging.test.ts`, every direct `mergeGroups(...)` call gains a 5th argument:
- Tests whose moved group has rotation equal to the target's (the delta-0 majority, including `'is a no-op for already-aligned rotations'`): pass `makePiece({ id: <movedPieceId> })` — the pivot is computed lazily, so the default piece's infinite bounds are never read.
- `'snaps the moved group rotation to the target rotation before merging'` (92° → 90°): pass the existing `piece0`; its center (50,50) equals the old bbox center for this single-piece group, so the expected values in the test are unchanged.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run src/game/group-merging.test.ts src/game/merge-detection.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/game/group-merging.ts src/game/group-merging.test.ts src/game/rotate-group.ts
git commit -m "feat(snap): pivot the merge rotation snap on the mated piece

measureEdgeAlignment now simulates the snap around the mated piece's
center; mergeGroups must rotate around the same pivot or the measured
snapDelta lands the group elsewhere. Wide groups now merge into exact
alignment when flush at the connecting piece.

Part of #530.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa"
```

---

### Task 3: Rotation assist pivots on the winning piece (assist, context, controller)

**Files:**
- Modify: `src/game/snap-proximity-rotation.ts`
- Modify: `src/game/snap-proximity-context.ts` (remove `centerLocal`)
- Modify: `src/interaction/snap-proximity-rotation-controller.ts:56-69`
- Test: `src/game/snap-proximity-rotation.test.ts`
- Test: `src/interaction/snap-proximity-rotation-controller.test.ts`

**Interfaces:**
- Consumes: `pieceCenterLocal` from Task 1; `rotateGroup(group, piecesById, deltaDegrees, pivotLocal?)` from Task 2.
- Produces:
  - `export interface SnapProximityRotationResult { deltaDeg: number; pivotLocal: Point }` in `src/game/snap-proximity-rotation.ts`.
  - `computeSnapProximityRotation(state, ctx): SnapProximityRotationResult | null` (was `number | null`).
  - `ProximityContext` WITHOUT `centerLocal`; `buildProximityContext` no longer calls `getGroupLocalBounds`.

- [ ] **Step 1: Write the failing test**

Append to `src/game/snap-proximity-rotation.test.ts` (import `makeWideRowScenario` from fixtures):

```ts
describe('piece-anchored assist pivot (issue #530)', () => {
    it('engages for a wide group flush at one piece and pivots on that piece', () => {
        const { state } = makeWideRowScenario(8);
        const ctx = buildProximityContext(
            state, 11, { tolerancePx: 18, rotationToleranceDeg: 10 },
        );
        expect(ctx).not.toBeNull();

        const result = computeSnapProximityRotation(state, ctx!);
        // d ≈ 0 is inside the completion fraction → cap 0 → full correction.
        expect(result!.deltaDeg).toBeCloseTo(-8);
        expect(result!.pivotLocal.x).toBeCloseTo(50);
        expect(result!.pivotLocal.y).toBeCloseTo(50);

        // Applying the correction around the returned pivot is idempotent.
        rotateGroup(getGroup(state, 11), state.piecesById, result!.deltaDeg, result!.pivotLocal);
        expect(getGroup(state, 11).rotation).toBeCloseTo(0);
        expect(computeSnapProximityRotation(state, ctx!)).toBeNull();
    });
});
```

(Under pre-change code this scenario returns `null` outright: the group-center-pivot measurement puts `d` ≈ 27.9 > 18.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: the new test FAILS (compile error on `.deltaDeg` of `number`, or `null` result under the old measurement); existing tests pass.

- [ ] **Step 3: Implement the result shape and winner tracking**

In `src/game/snap-proximity-rotation.ts`:

```ts
export interface SnapProximityRotationResult {
    /** Signed degrees to apply now via `rotateGroup`. */
    deltaDeg: number;
    /** Rotation pivot in un-rotated group-local space: the winning candidate piece's center. */
    pivotLocal: Point;
}

export function computeSnapProximityRotation(
    state: GameState,
    ctx: ProximityContext,
): SnapProximityRotationResult | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    let bestDistance = Infinity;
    let bestRotationDelta = 0;
    let bestPiece: Piece | null = null;
    for (const candidate of ctx.candidates) {
        const m = measureEdgeAlignment(
            candidate.piece, candidate.edge, group,
            candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
        );
        if (Math.abs(m.rotationDelta) > ctx.rotationToleranceDeg) continue;
        if (m.distance > ctx.tolerancePx) continue;
        if (m.distance < bestDistance) {
            bestDistance = m.distance;
            bestRotationDelta = m.rotationDelta;
            bestPiece = candidate.piece;
        }
    }
    if (bestPiece === null) return null;

    const ramp =
        (bestDistance / ctx.tolerancePx - ROTATION_COMPLETE_AT_FRACTION) /
        (1 - ROTATION_COMPLETE_AT_FRACTION);
    const cap = ctx.rotationToleranceDeg * clamp01(ramp);
    const excess = Math.abs(bestRotationDelta) - cap;
    if (excess <= SNAP_EPSILON_DEG) return null;

    return {
        deltaDeg: Math.sign(bestRotationDelta) * excess,
        pivotLocal: pieceCenterLocal(group, bestPiece),
    };
}
```

Imports: add `pieceCenterLocal` to the `merge-detection.js` import; add `Piece`/`Point` to the type imports as needed. Update the module header's invariance paragraph — it currently claims the bbox-center pivot keeps the measured distance invariant. Replace that sentence with the relocated contract (category 6, it is the ratchet's correctness argument):

```
The applied rotation pivots on the winning candidate piece's center —
the same pivot the measurement simulates — so the winner's measured
distance is invariant under the rotation this module applies; the ramp
is driven purely by how close the player drags the group. The pivot
follows the winner: if another candidate becomes closest mid-drag the
swing recenters on it.
```

Also update the `computeSnapProximityRotation` doc's first line ("in signed degrees (apply via `rotateGroup`)") to mention applying `deltaDeg` around `pivotLocal`.

- [ ] **Step 4: Remove `centerLocal` from the context**

In `src/game/snap-proximity-context.ts`: delete the `centerLocal` field from `ProximityContext`, the bounds computation in `buildProximityContext`, and the now-unused `getGroupLocalBounds` import (its doc-comment mention of the field goes with it).

- [ ] **Step 5: Update the controller**

In `src/interaction/snap-proximity-rotation-controller.ts`, `onGroupMoved` becomes:

```ts
onGroupMoved(): void {
    if (!this.ctx || this.gated) return;
    this.gated = true;
    this.scheduleFrame(() => { this.gated = false; });

    const state = this.getState();
    const result = computeSnapProximityRotation(state, this.ctx);
    if (result === null) return;

    const group = tryGetGroup(state, this.ctx.groupId);
    if (group) {
        rotateGroup(group, state.piecesById, result.deltaDeg, result.pivotLocal);
    }
}
```

The comment about reusing `ctx.centerLocal` as the pivot is deleted (its subject is gone).

- [ ] **Step 6: Add the controller wiring test**

The existing controller tests use single-piece groups, where dropping the pivot argument (falling back to the bbox center) would be invisible. Append to `src/interaction/snap-proximity-rotation-controller.test.ts` (import `makeWideRowScenario` from fixtures and `getWorldPosition` from `../model/helpers.js`; the local `makeController` helper hardcodes D=40/T=20, so construct inline with the merge-default tolerances — the wide group only qualifies under them via the piece-anchored measurement):

```ts
it('applies the correction around the winning piece (wide-group wiring)', () => {
    const { state } = makeWideRowScenario(8);
    const controller = new SnapProximityRotationController({
        getState: () => state,
        getTolerances: () => ({ tolerancePx: 18, rotationToleranceDeg: 10 }),
        scheduleFrame: () => {},
    });
    const before = getWorldPosition({ x: 50, y: 50 }, 1, getGroup(state, 11));

    controller.start(11);
    controller.onGroupMoved();

    const group = getGroup(state, 11);
    expect(group.rotation).toBeCloseTo(0);
    const after = getWorldPosition({ x: 50, y: 50 }, 1, group);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
});
```

(If the pivot were dropped, `rotateGroup` would fall back to the group bbox center: `rotation` still reaches 0, but piece 1's center would move ≈ 27.9 px — the position assertions are the ones doing the work.)

- [ ] **Step 7: Update existing rotation-assist tests to the new return shape**

In `src/game/snap-proximity-rotation.test.ts`, mechanical pattern:
- `expect(computeSnapProximityRotation(state, ctx)).toBeNull()` — unchanged.
- `expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(N)` → `expect(computeSnapProximityRotation(state, ctx)!.deltaDeg).toBeCloseTo(N)`.
- `rotateGroup(group, state.piecesById, computeSnapProximityRotation(state, ctx)!)` → capture the result and pass `result.deltaDeg` (these tests use single-piece groups, where pivot and bbox center coincide — passing the pivot is equivalent; pass `result.pivotLocal` for uniformity).
- In the `buildProximityContext` describe block, delete the two `ctx!.centerLocal` assertions (the field is gone) and drop "and bbox center" from that test's name.

- [ ] **Step 8: Run the affected suites**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts src/game/snap-proximity-position.test.ts src/interaction/snap-proximity-rotation-controller.test.ts src/interaction/snap-proximity-position-controller.test.ts`
Expected: ALL PASS (controller tests use single-piece groups, unaffected by the pivot change).

- [ ] **Step 9: Commit**

```bash
git add src/game/snap-proximity-rotation.ts src/game/snap-proximity-rotation.test.ts src/game/snap-proximity-context.ts src/interaction/snap-proximity-rotation-controller.ts src/interaction/snap-proximity-rotation-controller.test.ts
git commit -m "feat(snap): pivot the proximity rotation assist on the winning piece

The assist now returns the winning candidate piece's center along with
the correction, and the controller rotates around it: the connecting
piece stays anchored while the rest of the group swings into alignment.
The pivot follows the winner if the closest candidate changes mid-drag.

Closes #530.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa"
```

---

### Task 4: Full verification and PR

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: ALL PASS — including `src/puzzle/topology/dcel-broad-phase-equivalence.test.ts` (geometry digests untouched; if it is red, STOP — something moved generated geometry, which this change must not do). Do not run `vitest -u`.

- [ ] **Step 2: Build and lint**

Run: `npm run build && npm run lint`
Expected: both clean. If lint flags an unused import (`getGroupLocalBounds` in either edited module), remove it.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/piece-anchored-snap-pivot
gh pr create --title "feat(snap): anchor snap pivots on the mated piece" --body "Closes #530

## What

Big groups refused to merge when a mated edge was visually flush: the rotation snap was simulated (and applied) around the moved group's bbox center, so a flush edge on a wide group measured ~group-radius × θ away from its snapped placement. The merge measurement, the merge itself, and the snap-proximity rotation assist now all pivot on the mated piece's center — the connecting piece stays anchored and the rest of the group swings into alignment. The assist pivot follows the closest candidate (sticky-winner is the agreed fallback if this feels wrong in play).

Single-piece groups are unaffected (piece center = bbox center), quarter-turn mode is unaffected (rotation delta is always 0).

Spec: docs/superpowers/specs/2026-08-08-snap-piece-anchored-pivot-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HNQ5xLMoDYnxtUDHNkvLJa"
```

- [ ] **Step 4: Verify CI**

Run: `gh pr checks --watch`
Expected: all checks green. A passing local suite is not evidence CI passed.
