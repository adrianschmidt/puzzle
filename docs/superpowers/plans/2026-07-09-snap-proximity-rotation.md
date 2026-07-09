# Snap Proximity Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While dragging a group in free-rotation mode, progressively rotate it toward the snapped orientation as it approaches a matching neighbor it would merge with on drop — one-way (never rotates back), and cheap enough to run per pointer-move.

**Architecture:** Extract the edge-pair measurement out of `checkEdgeAlignment` so merge detection and the new feature share one source of truth. A pure module (`src/game/snap-proximity-rotation.ts`) builds a per-drag context (border-edge candidates + cached rotation pivot + tolerances) and computes a signed rotation delta using a distance-scaled cap: `cap = T × (d / D)`; the group is rotated so its angular error never exceeds the cap. A small controller (`src/interaction/snap-proximity-rotation-controller.ts`) owns drag lifecycle and frame gating, and is wired into `setupInteraction`.

**Tech Stack:** TypeScript, Vitest (jsdom only where the existing test file already uses it). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-snap-proximity-rotation-design.md`

## Global Constraints

- American English in all identifiers, comments, and strings (e.g. `center`, not `centre`).
- The feature consumes **no** seeded randomness — it must never call the puzzle PRNG (share-link reproducibility contract).
- `detectMerges` / `checkEdgeAlignment` observable behavior must be unchanged — the Task 1 refactor is a pure extraction; the existing merge-detection test suite is the regression gate.
- Merging still happens **only on drop**. This feature only rotates the dragged group; it never nudges position and never triggers a merge.
- Test files live next to the source they test.
- No help-text (`src/ui/info-modal.ts`) changes — per spec, existing sentences stay correct.
- Run a single test file with `npx vitest run <path>`; full suite with `npm test`.
- Cap formula and activation condition (verbatim from spec): active only while dragging and `state.rotationMode === 'free'`; a candidate qualifies iff positional edge distance `d ≤ D` (active snap distance) and angular error `|θ| ≤ T` (active rotation tolerance), measured with the same math `detectMerges` uses; closest `d` wins; `cap = T × (d / D)`; rotate by the signed excess only when `|θ| > cap`.

---

### Task 1: Extract `measureEdgeAlignment` from `checkEdgeAlignment`

**Files:**
- Modify: `src/game/merge-detection.ts:84-213`
- Test: `src/game/merge-detection.test.ts`

**Interfaces:**
- Consumes: existing internals of `merge-detection.ts` (`buildRotationSnapContext`, `getWorldPositionAfterRotationSnap`, `distance`).
- Produces (used by Task 3):

```ts
export interface EdgeAlignmentMeasurement {
    rotationDelta: number; // signed degrees, target − moved, wrap-aware, in (−180, 180]
    distance: number;      // avg endpoint distance in px, after simulated rotation snap
    snapDelta: Point;      // positional correction to perfect alignment
}

export function measureEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    movedCenterLocal?: Point, // optional precomputed bbox center of movedGroup (perf)
): EdgeAlignmentMeasurement
```

- [ ] **Step 1: Write the failing tests**

Add to `src/game/merge-detection.test.ts` (import `measureEdgeAlignment` in the existing import block from `./merge-detection.js`, and `getGroupLocalBounds` from `./group-bounds.js`):

```ts
describe('measureEdgeAlignment', () => {
    it('reports distance, rotation delta, and snap delta for an offset pair', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 112, y: 0 }); // 12px right of aligned

        const m = measureEdgeAlignment(
            piece1, leftEdge, group1,
            piece0, rightEdge, group0,
            new Map(),
        );

        expect(m.rotationDelta).toBeCloseTo(0);
        expect(m.distance).toBeCloseTo(12);
        expect(m.snapDelta.x).toBeCloseTo(-12);
        expect(m.snapDelta.y).toBeCloseTo(0);
    });

    it('reports the wrap-aware rotation delta (target − moved)', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        group0.rotation = 10;
        group1.rotation = 350;

        const m = measureEdgeAlignment(
            piece1, leftEdge, group1,
            piece0, rightEdge, group0,
            new Map(),
        );

        // From 350° to 10° the short way is +20°, not −340°.
        expect(m.rotationDelta).toBeCloseTo(20);
    });

    it('a precomputed movedCenterLocal yields identical measurements', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 108, y: 6 });
        group1.rotation = 15;
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        const plain = measureEdgeAlignment(
            piece1, leftEdge, group1, piece0, rightEdge, group0, piecesById,
        );
        const bounds = getGroupLocalBounds(group1, piecesById);
        const center = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        const precomputed = measureEdgeAlignment(
            piece1, leftEdge, group1, piece0, rightEdge, group0, piecesById, center,
        );

        expect(precomputed.rotationDelta).toBeCloseTo(plain.rotationDelta);
        expect(precomputed.distance).toBeCloseTo(plain.distance);
        expect(precomputed.snapDelta.x).toBeCloseTo(plain.snapDelta.x);
        expect(precomputed.snapDelta.y).toBeCloseTo(plain.snapDelta.y);
    });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/game/merge-detection.test.ts`
Expected: FAIL — `measureEdgeAlignment` is not exported.

- [ ] **Step 3: Implement the extraction**

In `src/game/merge-detection.ts`:

3a. Give `buildRotationSnapContext` an optional precomputed pivot (replace the existing function body's bounds block):

```ts
function buildRotationSnapContext(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    extraDeg: number,
    precomputedCenterLocal?: Point,
): RotationSnapContext | null {
    if (Math.abs(extraDeg) < SNAP_EPSILON_DEG) return null;
    let centerLocal = precomputedCenterLocal;
    if (!centerLocal) {
        const bounds = getGroupLocalBounds(group, piecesById);
        centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
    }
    return {
        centerLocal,
        worldCenter: localToWorld(centerLocal, group),
        newRotation: normalizeDegrees(group.rotation + extraDeg),
    };
}
```

3b. Add the measurement type + function directly above `checkEdgeAlignment`:

```ts
/**
 * Raw alignment measurement for a pair of mate edges — the single source
 * of truth shared by merge detection (thresholding on drop) and snap
 * proximity rotation (progressive rotation during drag).
 *
 * `distance` is measured AFTER simulating the rotation snap the merge
 * would perform, so it reflects how far the moved group is from its
 * snapped placement, not from its current-orientation overlap.
 */
export interface EdgeAlignmentMeasurement {
    /** Signed degrees the moved group must rotate to match the target (wrap-aware). */
    rotationDelta: number;
    /** Average distance between mate endpoints after the simulated rotation snap. */
    distance: number;
    /** Positional correction to perfect alignment (after the rotation snap). */
    snapDelta: Point;
}

/**
 * Measure how well a moved edge aligns with its mate, without applying
 * any tolerance. Pass `movedCenterLocal` (the moved group's bbox center
 * in un-rotated local space) to skip the per-call bounds traversal when
 * calling repeatedly for the same group — e.g. once per candidate per
 * animation frame during a drag.
 */
export function measureEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    movedCenterLocal?: Point,
): EdgeAlignmentMeasurement {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);

    const snapCtx = buildRotationSnapContext(
        movedGroup, piecesById, rotDelta, movedCenterLocal,
    );
    const movedStart = getWorldPositionAfterRotationSnap(
        movedEdge.start, movedPiece.id, movedGroup, snapCtx,
    );
    const movedEnd = getWorldPositionAfterRotationSnap(
        movedEdge.end, movedPiece.id, movedGroup, snapCtx,
    );

    // Mate edges run in opposite directions: start↔end are swapped.
    const targetStart = getWorldPosition(targetEdge.start, targetPiece.id, targetGroup);
    const targetEnd = getWorldPosition(targetEdge.end, targetPiece.id, targetGroup);

    const dist1 = distance(movedStart, targetEnd);
    const dist2 = distance(movedEnd, targetStart);

    return {
        rotationDelta: rotDelta,
        distance: (dist1 + dist2) / 2,
        snapDelta: {
            x: targetEnd.x - movedStart.x,
            y: targetEnd.y - movedStart.y,
        },
    };
}
```

3c. Rewrite `checkEdgeAlignment`'s body to threshold the measurement (keep its signature, JSDoc, and defaults exactly as they are):

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
    rotationTolerance: number = MERGE_ROTATION_TOLERANCE_DEG,
): { aligned: boolean; snapDelta: Point } {
    const m = measureEdgeAlignment(
        movedPiece, movedEdge, movedGroup,
        targetPiece, targetEdge, targetGroup,
        piecesById,
    );

    if (Math.abs(m.rotationDelta) > rotationTolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }
    if (m.distance > tolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }
    return { aligned: true, snapDelta: m.snapDelta };
}
```

Note: the old body short-circuited before the position math when rotation was out of tolerance; the extracted version always measures. That is a (trivial) perf change on the one-shot drop path only — the returned values are identical for every input. Preserve the existing comment about the rotation tolerance window by moving it onto the rotation threshold check.

- [ ] **Step 4: Run the merge-detection suite to verify everything passes**

Run: `npx vitest run src/game/merge-detection.test.ts`
Expected: PASS — all pre-existing tests (the regression gate) plus the three new ones.

- [ ] **Step 5: Run the full suite (other suites exercise merges heavily)**

Run: `npm test`
Expected: PASS with no failures.

- [ ] **Step 6: Commit**

```bash
git add src/game/merge-detection.ts src/game/merge-detection.test.ts
git commit -m "refactor(game): extract measureEdgeAlignment from checkEdgeAlignment"
```

---

### Task 2: Shared mated-pair fixture + `buildProximityContext`

**Files:**
- Modify: `src/test-helpers/fixtures.ts` (append fixture)
- Create: `src/game/snap-proximity-rotation.ts`
- Create: `src/game/snap-proximity-rotation.test.ts`

**Interfaces:**
- Consumes: `getBorderEdges`, `tryGetGroup` from `../model/helpers.js`; `getGroupLocalBounds` from `./group-bounds.js`.
- Produces (used by Tasks 3–5):

```ts
// fixtures.ts
export function makeMatedPiecePair(): { piece0: Piece; piece1: Piece }

// snap-proximity-rotation.ts
export interface ProximityContext {
    groupId: number;
    candidates: ReturnType<typeof getBorderEdges>;
    centerLocal: Point;
    tolerancePx: number;
    rotationToleranceDeg: number;
}
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerancePx: number,
    rotationToleranceDeg: number,
): ProximityContext | null
```

- [ ] **Step 1: Add the shared fixture**

Append to `src/test-helpers/fixtures.ts` (reuses the existing `makePiece`; `Edge` is already imported there — if not, add it to the type import):

```ts
/**
 * Two 100×100 pieces mated along a vertical edge, for snap/merge tests.
 *
 * Piece 0's right edge (id 0) mates with piece 1's left edge (id 1);
 * all other edges are puzzle borders. With both groups un-rotated and
 * piece offsets at (0,0), the correct relative placement puts piece 1's
 * group origin exactly 100px right of piece 0's.
 */
export function makeMatedPiecePair(): { piece0: Piece; piece1: Piece } {
    const edge = (
        id: number, start: Point, end: Point,
        matePieceId = -1, mateEdgeId = -1,
    ): Edge => ({ id, matePieceId, mateEdgeId, path: '', start, end });

    const piece0 = makePiece({ id: 0, edges: [
        edge(10, { x: 0, y: 0 }, { x: 100, y: 0 }),
        edge(0, { x: 100, y: 0 }, { x: 100, y: 100 }, 1, 1), // mates piece 1
        edge(11, { x: 100, y: 100 }, { x: 0, y: 100 }),
        edge(12, { x: 0, y: 100 }, { x: 0, y: 0 }),
    ] });
    const piece1 = makePiece({ id: 1, edges: [
        edge(13, { x: 0, y: 0 }, { x: 100, y: 0 }),
        edge(14, { x: 100, y: 0 }, { x: 100, y: 100 }),
        edge(15, { x: 100, y: 100 }, { x: 0, y: 100 }),
        edge(1, { x: 0, y: 100 }, { x: 0, y: 0 }, 0, 0), // mates piece 0
    ] });

    return { piece0, piece1 };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/game/snap-proximity-rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { buildProximityContext } from './snap-proximity-rotation.js';

const D = 40; // tolerancePx used throughout these tests
const T = 20; // rotationToleranceDeg used throughout these tests

function makeGroupOf(id: number, pieceId: number, position: Point, rotation = 0): PieceGroup {
    return { id, pieces: new Map([[pieceId, { x: 0, y: 0 }]]), position, rotation };
}

/**
 * State with piece 0 fixed at the origin (group 10) and piece 1 in its
 * own group (11). Correct placement for group 11 is position (100, 0),
 * i.e. bbox center (150, 50).
 */
function makePairState(
    group1Position: Point,
    group1Rotation = 0,
    rotationMode: GameState['rotationMode'] = 'free',
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeGroupOf(11, 1, group1Position, group1Rotation);
    return makeGameState({
        pieces: [piece0, piece1],
        groups: [group0, group1],
        rotationMode,
    });
}

describe('buildProximityContext', () => {
    it('returns a context with the border candidates and bbox center', () => {
        const state = makePairState({ x: 300, y: 0 });
        const ctx = buildProximityContext(state, 11, D, T);

        expect(ctx).not.toBeNull();
        expect(ctx!.groupId).toBe(11);
        expect(ctx!.candidates).toHaveLength(1);
        expect(ctx!.candidates[0].matePiece.id).toBe(0);
        expect(ctx!.centerLocal.x).toBeCloseTo(50);
        expect(ctx!.centerLocal.y).toBeCloseTo(50);
        expect(ctx!.tolerancePx).toBe(D);
        expect(ctx!.rotationToleranceDeg).toBe(T);
    });

    it('returns null unless rotation mode is free', () => {
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, 'none'), 11, D, T)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, 'quarter-turn'), 11, D, T)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, undefined), 11, D, T)).toBeNull();
    });

    it('returns null for an unknown group', () => {
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }), 99, D, T)).toBeNull();
    });

    it('returns null when the group has no cross-group mates', () => {
        // Both pieces in ONE group: the mate edge is internal, not a border.
        const { piece0, piece1 } = makeMatedPiecePair();
        const merged: PieceGroup = {
            id: 10,
            pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
        const state = makeGameState({
            pieces: [piece0, piece1],
            groups: [merged],
            rotationMode: 'free',
        });

        expect(buildProximityContext(state, 10, D, T)).toBeNull();
    });

    it('returns null for a non-positive tolerance', () => {
        expect(buildProximityContext(makePairState({ x: 120, y: 0 }), 11, 0, T)).toBeNull();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: FAIL — module `./snap-proximity-rotation.js` does not exist.

- [ ] **Step 4: Implement the module (context building only)**

Create `src/game/snap-proximity-rotation.ts`:

```ts
/**
 * Snap proximity rotation — progressive rotation feedback while dragging.
 *
 * When free rotation is enabled and a dragged group is close enough to a
 * matching neighbor that dropping it would merge (within both the snap
 * distance and the rotation tolerance), the group progressively rotates
 * toward the snapped orientation as the remaining distance shrinks.
 *
 * The rotation is one-way by construction: the allowed angular error is
 * capped at `rotationTolerance * (distance / tolerance)`. Moving closer
 * tightens the cap (rotation is applied and persists); moving away only
 * loosens it, which never rotates the group back. Pivot-preserving
 * rotation (`rotateGroup`) keeps the group's bbox center fixed, so the
 * measured distance is invariant under the rotation this module applies —
 * the ramp is driven purely by how close the player drags the group.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group
 * would snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';
import { measureEdgeAlignment, SNAP_EPSILON_DEG } from './merge-detection.js';

/**
 * Per-drag precomputed context. Valid only while the dragged group's
 * composition and every mate group stay unchanged — true for the duration
 * of a single-group drag, because merges happen only on drop. Build at
 * drag start, discard on drop/cancel.
 */
export interface ProximityContext {
    /** The dragged group. */
    groupId: number;
    /** Border edges of the dragged group and their mates (fixed during a drag). */
    candidates: ReturnType<typeof getBorderEdges>;
    /** Dragged group's bbox center in un-rotated local space — the rotation pivot. */
    centerLocal: Point;
    /** Active snap distance (D) in world px. */
    tolerancePx: number;
    /** Active rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Build the per-drag context, or `null` when the feature does not apply:
 * not in free-rotation mode, unknown group, no cross-group mates, or a
 * degenerate tolerance.
 */
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerancePx: number,
    rotationToleranceDeg: number,
): ProximityContext | null {
    if (state.rotationMode !== 'free') return null;
    if (tolerancePx <= 0) return null;

    const group = tryGetGroup(state, movedGroupId);
    if (!group) return null;

    const candidates = getBorderEdges(group, state);
    if (candidates.length === 0) return null;

    const bounds = getGroupLocalBounds(group, state.piecesById);
    return {
        groupId: movedGroupId,
        candidates,
        centerLocal: {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        },
        tolerancePx,
        rotationToleranceDeg,
    };
}
```

(`measureEdgeAlignment` and `SNAP_EPSILON_DEG` are imported now but used in Task 3 — if the linter complains about unused imports, add them in Task 3 instead.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/test-helpers/fixtures.ts src/game/snap-proximity-rotation.ts src/game/snap-proximity-rotation.test.ts
git commit -m "feat(game): add proximity context builder for snap rotation"
```

---

### Task 3: `computeSnapProximityRotation` — the cap math

**Files:**
- Modify: `src/game/snap-proximity-rotation.ts`
- Modify: `src/game/snap-proximity-rotation.test.ts`

**Interfaces:**
- Consumes: `ProximityContext` (Task 2), `measureEdgeAlignment` + `SNAP_EPSILON_DEG` (Task 1), `rotateGroup` from `./rotate-group.js` (tests only).
- Produces (used by Task 4):

```ts
export function computeSnapProximityRotation(
    state: GameState,
    ctx: ProximityContext,
): number | null  // signed degrees to apply via rotateGroup, or null
```

**Geometry used in the tests below.** Piece 1's aligned bbox center is (150, 50) when its mate group sits un-rotated at the origin. A pivot-preserving rotation keeps the bbox center fixed, and with an un-rotated mate the simulated-snap distance equals the center displacement exactly. So tests place group 11 by choosing a center and rotation:

```ts
position = { x: center.x − rotatePoint({x: 50, y: 50}, rotation).x,
             y: center.y − rotatePoint({x: 50, y: 50}, rotation).y }
```

- [ ] **Step 1: Write the failing tests**

Add to `src/game/snap-proximity-rotation.test.ts` (extend the import block with `computeSnapProximityRotation` and the `ProximityContext` type, plus `rotatePoint` and `getGroup` from `../model/helpers.js`, `rotateGroup` from `./rotate-group.js`, and `makePiece` from the fixtures):

```ts
/** Group-11 position that puts its bbox center at `center` for a given rotation. */
function positionForCenter(center: Point, rotation: number): Point {
    const r = rotatePoint({ x: 50, y: 50 }, rotation);
    return { x: center.x - r.x, y: center.y - r.y };
}

/** Build the pair state + context in one go; throws if the context is unexpectedly null. */
function makeComputeSetup(center: Point, rotation: number): { state: GameState; ctx: ProximityContext } {
    const state = makePairState(positionForCenter(center, rotation), rotation);
    const ctx = buildProximityContext(state, 11, D, T);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('computeSnapProximityRotation', () => {
    it('returns null when the group is beyond the snap distance', () => {
        const { state, ctx } = makeComputeSetup({ x: 150 + D + 5, y: 50 }, 18);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the rotation is beyond the rotation tolerance', () => {
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, T + 5);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the angular error is already under the cap (no jump on zone entry)', () => {
        // d = 30 → cap = 20 × 30/40 = 15; error 10 < 15 → nothing to do.
        const { state, ctx } = makeComputeSetup({ x: 180, y: 50 }, 10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('rotates the error down to the distance-scaled cap, and is idempotent at rest', () => {
        // d = 20 → cap = 10; error 18 → excess 8, toward alignment (negative).
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 18);
        const delta = computeSnapProximityRotation(state, ctx);
        expect(delta).toBeCloseTo(-8);

        // Applying the delta and re-evaluating without moving: no oscillation.
        rotateGroup(getGroup(state, 11), state.piecesById, delta!);
        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('fully aligns at zero distance', () => {
        const { state, ctx } = makeComputeSetup({ x: 150, y: 50 }, 15);
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-15);
    });

    it('is wrap-aware: rotations just below 360° rotate forward through 0°', () => {
        // error = signedAngularDelta(0, 342) = +18; d = 20 → cap = 10 → +8.
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 342);
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(8);
    });

    it('never rotates back as the distance increases again (one-way ratchet)', () => {
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 18);
        const group = getGroup(state, 11);

        // Approach: d = 20 → rotated down to the cap (10°).
        rotateGroup(group, state.piecesById, computeSnapProximityRotation(state, ctx)!);
        expect(group.rotation).toBeCloseTo(10);

        // Retreat to d = 36 (cap = 18 > 10): no correction, rotation stays.
        group.position = { ...group.position, x: group.position.x + 16 };
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
        expect(group.rotation).toBeCloseTo(10);
    });

    it('the closest qualifying mate wins', () => {
        // Middle piece (1) mated on both sides; see makeRowState below.
        const { state, ctx } = makeRowState();
        // Left mate at d = 12 (cap 6), right mate at d = 8 (cap 4); error 16 on both.
        // Closest (right) wins: excess = 16 − 4 = 12, toward alignment.
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-12);
    });
});
```

And the three-piece fixture for the closest-wins test (in the same test file):

```ts
/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, each 100×100, mated along
 * vertical edges. Piece 1 (the moved group, id 11) sits with its center
 * displaced +12px from alignment with piece 0's group, while piece 2's
 * group is itself displaced +4px right of ITS correct spot — so piece 1
 * is only 8px from alignment with piece 2. Both mates un-rotated;
 * piece 1 rotated 16°.
 */
function makeRowState(): { state: GameState; ctx: ProximityContext } {
    const { piece0, piece1 } = makeMatedPiecePair();
    // Extend piece 1 with a right-edge mate to a third piece.
    const rightMate = { id: 2, matePieceId: 2, mateEdgeId: 3, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    piece1.edges[1] = rightMate; // replace the border right edge (id 14)
    const piece2 = makePiece({ id: 2, edges: [
        { id: 16, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 17, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
        { id: 18, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
        { id: 3, matePieceId: 1, mateEdgeId: 2, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ] });

    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeGroupOf(11, 1, positionForCenter({ x: 162, y: 50 }, 16), 16);
    const group2 = makeGroupOf(12, 2, { x: 204, y: 0 }); // +4px right of correct (200, 0)
    const state = makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
    const ctx = buildProximityContext(state, 11, D, T);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}
```

(`makePiece` must be added to the fixtures import in the test file.)

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: FAIL — `computeSnapProximityRotation` is not exported. Task 2's tests still PASS.

- [ ] **Step 3: Implement the computation**

Append to `src/game/snap-proximity-rotation.ts`:

```ts
/**
 * Compute the rotation to apply to the dragged group right now, in signed
 * degrees (apply via `rotateGroup`), or `null` when no correction is due.
 *
 * A candidate qualifies exactly when a drop would merge it: simulated-snap
 * distance `d ≤ tolerancePx` AND angular error `|θ| ≤ rotationToleranceDeg`.
 * Among qualifying candidates the smallest `d` wins. The correction
 * reduces `|θ|` to `cap = rotationToleranceDeg × (d / tolerancePx)` — at
 * the zone edge the cap equals the tolerance (no jump on entry), at zero
 * distance the group is fully aligned.
 */
export function computeSnapProximityRotation(
    state: GameState,
    ctx: ProximityContext,
): number | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    let bestDistance = Infinity;
    let bestRotationDelta = 0;
    for (const candidate of ctx.candidates) {
        const m = measureEdgeAlignment(
            candidate.piece, candidate.edge, group,
            candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
            state.piecesById, ctx.centerLocal,
        );
        if (Math.abs(m.rotationDelta) > ctx.rotationToleranceDeg) continue;
        if (m.distance > ctx.tolerancePx) continue;
        if (m.distance < bestDistance) {
            bestDistance = m.distance;
            bestRotationDelta = m.rotationDelta;
        }
    }
    if (!isFinite(bestDistance)) return null;

    const cap = ctx.rotationToleranceDeg * (bestDistance / ctx.tolerancePx);
    const excess = Math.abs(bestRotationDelta) - cap;
    if (excess <= SNAP_EPSILON_DEG) return null;

    return Math.sign(bestRotationDelta) * excess;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/snap-proximity-rotation.ts src/game/snap-proximity-rotation.test.ts
git commit -m "feat(game): compute snap proximity rotation with distance-scaled cap"
```

---

### Task 4: Frame-gated controller

**Files:**
- Create: `src/interaction/snap-proximity-rotation-controller.ts`
- Create: `src/interaction/snap-proximity-rotation-controller.test.ts`

**Interfaces:**
- Consumes: `buildProximityContext`, `computeSnapProximityRotation`, `ProximityContext` (Tasks 2–3); `rotateGroup` from `../game/rotate-group.js`; `tryGetGroup` from `../model/helpers.js`.
- Produces (used by Task 5):

```ts
export interface SnapProximityRotationOptions {
    getState: () => GameState;
    /** Active snap tolerances; read once per drag, at start(). */
    getTolerances: () => { tolerancePx: number; rotationToleranceDeg: number };
    /** Injectable frame scheduler for tests. Defaults to requestAnimationFrame. */
    scheduleFrame?: (cb: () => void) => void;
}
export class SnapProximityRotationController {
    constructor(options: SnapProximityRotationOptions)
    start(groupId: number): void
    onGroupMoved(): void
    stop(): void
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/interaction/snap-proximity-rotation-controller.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { getGroup, rotatePoint } from '../model/helpers.js';
import { SnapProximityRotationController } from './snap-proximity-rotation-controller.js';

const D = 40;
const T = 20;

/**
 * Pair state as in snap-proximity-rotation.test.ts: piece 0 fixed at the
 * origin (group 10); piece 1 (group 11) placed by bbox center + rotation.
 * Aligned center for group 11 is (150, 50).
 */
function makePairState(
    center: Point,
    rotation: number,
    rotationMode: GameState['rotationMode'] = 'free',
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const r = rotatePoint({ x: 50, y: 50 }, rotation);
    const group0: PieceGroup = { id: 10, pieces: new Map([[0, { x: 0, y: 0 }]]), position: { x: 0, y: 0 }, rotation: 0 };
    const group1: PieceGroup = {
        id: 11,
        pieces: new Map([[1, { x: 0, y: 0 }]]),
        position: { x: center.x - r.x, y: center.y - r.y },
        rotation,
    };
    return makeGameState({ pieces: [piece0, piece1], groups: [group0, group1], rotationMode });
}

/** Controller wired to a manually flushable frame scheduler. */
function makeController(state: GameState): {
    controller: SnapProximityRotationController;
    flushFrame: () => void;
} {
    let pending: Array<() => void> = [];
    const controller = new SnapProximityRotationController({
        getState: () => state,
        getTolerances: () => ({ tolerancePx: D, rotationToleranceDeg: T }),
        scheduleFrame: (cb) => { pending.push(cb); },
    });
    return {
        controller,
        flushFrame: () => {
            const cbs = pending;
            pending = [];
            for (const cb of cbs) cb();
        },
    };
}

describe('SnapProximityRotationController', () => {
    it('rotates the dragged group toward alignment on move', () => {
        // d = 20 → cap = 10; error 18 → rotated down to 10°.
        const state = makePairState({ x: 170, y: 50 }, 18);
        const { controller } = makeController(state);

        controller.start(11);
        controller.onGroupMoved();

        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
    });

    it('does nothing before start() or after stop()', () => {
        const state = makePairState({ x: 170, y: 50 }, 18);
        const { controller, flushFrame } = makeController(state);

        controller.onGroupMoved();
        expect(getGroup(state, 11).rotation).toBeCloseTo(18);

        controller.start(11);
        controller.stop();
        flushFrame();
        controller.onGroupMoved();
        expect(getGroup(state, 11).rotation).toBeCloseTo(18);
    });

    it('does nothing when rotation mode is not free', () => {
        const state = makePairState({ x: 170, y: 50 }, 18, 'quarter-turn');
        const { controller } = makeController(state);

        controller.start(11);
        controller.onGroupMoved();

        expect(getGroup(state, 11).rotation).toBeCloseTo(18);
    });

    it('evaluates at most once per frame, then resumes after the frame fires', () => {
        const state = makePairState({ x: 170, y: 50 }, 18);
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);

        controller.start(11);
        controller.onGroupMoved(); // evaluates: 18 → 10 (d = 20)
        expect(group.rotation).toBeCloseTo(10);

        // Move closer (d = 10 → cap = 5), but the frame gate is still set.
        group.position = { ...group.position, x: group.position.x - 10 };
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(10); // gated: no change

        flushFrame();
        controller.onGroupMoved(); // evaluates again: 10 → 5
        expect(group.rotation).toBeCloseTo(5);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/interaction/snap-proximity-rotation-controller.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the controller**

Create `src/interaction/snap-proximity-rotation-controller.ts`:

```ts
/**
 * Drag-lifecycle wrapper around snap proximity rotation.
 *
 * Owns the per-drag context (built once at drag start) and frame gating:
 * pointer-move events can outpace the display refresh, so evaluation runs
 * at most once per animation frame. The first move in a frame evaluates
 * immediately (no added latency); later moves in the same frame are
 * skipped. All the geometry lives in `game/snap-proximity-rotation.ts`.
 *
 * `stop()` only discards the context — rotation already applied stays,
 * including on a canceled drag (it rotated toward the correct alignment,
 * so keeping it is harmless). Callers must stop() before a cancel-restore
 * so the restore's moveGroup callback doesn't trigger a stray evaluation.
 */

import type { GameState } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { rotateGroup } from '../game/rotate-group.js';
import {
    buildProximityContext,
    computeSnapProximityRotation,
} from '../game/snap-proximity-rotation.js';
import type { ProximityContext } from '../game/snap-proximity-rotation.js';

export interface SnapProximityRotationOptions {
    getState: () => GameState;
    /** Active snap tolerances; read once per drag, at start(). */
    getTolerances: () => { tolerancePx: number; rotationToleranceDeg: number };
    /** Injectable frame scheduler for tests. Defaults to requestAnimationFrame. */
    scheduleFrame?: (cb: () => void) => void;
}

export class SnapProximityRotationController {
    private ctx: ProximityContext | null = null;
    private gated = false;
    private readonly getState: () => GameState;
    private readonly getTolerances: SnapProximityRotationOptions['getTolerances'];
    private readonly scheduleFrame: (cb: () => void) => void;

    constructor(options: SnapProximityRotationOptions) {
        this.getState = options.getState;
        this.getTolerances = options.getTolerances;
        this.scheduleFrame = options.scheduleFrame
            ?? ((cb) => { requestAnimationFrame(() => cb()); });
    }

    /**
     * Begin tracking a drag of `groupId`. Cheap no-op context (null) unless
     * the game is in free-rotation mode and the group has cross-group mates.
     */
    start(groupId: number): void {
        const { tolerancePx, rotationToleranceDeg } = this.getTolerances();
        this.ctx = buildProximityContext(
            this.getState(), groupId, tolerancePx, rotationToleranceDeg,
        );
        this.gated = false;
    }

    /** Evaluate after the dragged group moved; at most once per frame. */
    onGroupMoved(): void {
        if (!this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const state = this.getState();
        const delta = computeSnapProximityRotation(state, this.ctx);
        if (delta === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        if (group) rotateGroup(group, state.piecesById, delta);
    }

    /** End tracking (drop or cancel). Rotation already applied stays. */
    stop(): void {
        this.ctx = null;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/interaction/snap-proximity-rotation-controller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interaction/snap-proximity-rotation-controller.ts src/interaction/snap-proximity-rotation-controller.test.ts
git commit -m "feat(interaction): add frame-gated snap proximity rotation controller"
```

---

### Task 5: Wire into `setupInteraction` and `main.ts`

**Files:**
- Modify: `src/interaction/setup-interaction.ts`
- Modify: `src/interaction/index.ts`
- Modify: `src/main.ts:805-848` (the `setupInteraction` call)
- Test: `src/interaction/setup-interaction.test.ts`

**Interfaces:**
- Consumes: `SnapProximityRotationController` (Task 4); `getActiveTolerance` / `getActiveRotationTolerance` from `src/ui/merge-tolerance.ts` (already imported in `main.ts`).
- Produces: new optional `InteractionSetupOptions` field:

```ts
getSnapTolerances?: () => { tolerancePx: number; rotationToleranceDeg: number };
```

When the option is absent the controller is not created and behavior is exactly as before (all existing `setupInteraction` tests must pass untouched).

- [ ] **Step 1: Write the failing wiring tests**

Add to `src/interaction/setup-interaction.test.ts` (extend the fixtures import with `makeMatedPiecePair`, and import `rotatePoint` from `../model/helpers.js`):

```ts
describe('snap proximity rotation', () => {
    /**
     * Free-rotation state: piece 0 (group 7) at the origin, piece 1
     * (group 8) rotated 18° with its bbox center 20px right of its
     * aligned center (150, 50).
     */
    function makeFreeRotationState(rotationMode: GameState['rotationMode'] = 'free'): GameState {
        const { piece0, piece1 } = makeMatedPiecePair();
        const r = rotatePoint({ x: 50, y: 50 }, 18);
        const group7: PieceGroup = { id: 7, pieces: new Map([[0, { x: 0, y: 0 }]]), position: { x: 0, y: 0 }, rotation: 0 };
        const group8: PieceGroup = {
            id: 8,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 170 - r.x, y: 50 - r.y },
            rotation: 18,
        };
        return makeGameState({ pieces: [piece0, piece1], groups: [group7, group8], rotationMode });
    }

    const getSnapTolerances = () => ({ tolerancePx: 40, rotationToleranceDeg: 20 });

    function dragPieceOne(container: FakeContainer, toX: number): void {
        const pieceTarget = { _pieceId: 1 } as unknown as EventTarget;
        container.fire('pointerdown', fakePointerEvent({ target: pieceTarget, pointerId: 1, clientX: 300, clientY: 300 }));
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 320, clientY: 300 })); // promote
        container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: toX, clientY: 300 })); // real move
    }

    it('rotates the dragged group toward a nearby mate during a free-rotation drag', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState();

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            getSnapTolerances,
        });

        // Move 10px left: center 170 → 160, d = 10 → cap = 5; 18° → 5°.
        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(5);
    });

    it('does not rotate when rotation mode is not free', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState('quarter-turn');

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            getSnapTolerances,
        });

        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(18);
    });

    it('does not rotate during a multi-selection drag', () => {
        const container = createFakeContainer();
        const state = makeFreeRotationState();
        const selectionManager = new SelectionManager();
        selectionManager.toolActive = true;
        selectionManager.select(7);
        selectionManager.select(8);

        setupInteraction({
            container: container as unknown as HTMLElement,
            renderer: createFakeRenderer(),
            viewportTransform: new ViewportTransform(),
            getState: () => state,
            onStateChanged: vi.fn(),
            onDrop: vi.fn(),
            onViewportChanged: vi.fn(),
            selectionManager,
            getSnapTolerances,
        });

        dragPieceOne(container, 310);

        expect(state.groupsById.get(8)!.rotation).toBeCloseTo(18);
    });
});
```

Notes for the implementer:
- The file's `beforeEach` replaces `requestAnimationFrame` with a stub whose callback never runs, so the frame gate stays closed after the first evaluation — each test asserts on the single evaluation triggered by the one real move.
- The promote move calls `onPieceDrag.start` (which starts the controller); only the following move actually moves the group and triggers evaluation.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: the three new tests FAIL (TypeScript: unknown option `getSnapTolerances`; behaviorally: rotation stays 18). All pre-existing tests PASS.

- [ ] **Step 3: Implement the wiring in `setup-interaction.ts`**

3a. Import (with the other controller imports at the top):

```ts
import { SnapProximityRotationController } from './snap-proximity-rotation-controller.js';
```

3b. Add to `InteractionSetupOptions`:

```ts
/**
 * Active snap tolerances for snap proximity rotation (progressive
 * rotation toward a mate while dragging in free-rotation mode).
 * When omitted, the feature is disabled.
 */
getSnapTolerances?: () => { tolerancePx: number; rotationToleranceDeg: number };
```

…and `getSnapTolerances` to the destructuring at the top of `setupInteraction`.

3c. Create the controller after `deltaToWorld` / `expandToSelection` are defined, before the `DragController` construction:

```ts
const snapRotation = getSnapTolerances
    ? new SnapProximityRotationController({ getState, getTolerances: getSnapTolerances })
    : null;
```

3d. Notify it from BOTH move paths — after the loop in the `DragController` callbacks' `moveGroup` (`src/interaction/setup-interaction.ts:80-85`) and after the loop in the `AutoPanController` callbacks' `moveGroup` (`src/interaction/setup-interaction.ts:59-64`):

```ts
moveGroup(groupId, delta) {
    for (const id of expandToSelection(groupId)) {
        const group = tryGetGroup(getState(), id);
        if (group) moveGroup(group, delta);
    }
    snapRotation?.onGroupMoved();
},
```

(The rotation is applied before the drag controller's `requestRender()`, so each pointer-move renders once, with the rotation included.)

3e. Drive the lifecycle from the `onPieceDrag` hooks:

- In `start`, after `autoPan?.updatePointer(...)`:

```ts
// Snap proximity rotation only tracks single-group drags: rotating one
// group of a multi-selection would disturb the arrangement being moved.
if (expandToSelection(drag.groupId).length === 1) {
    snapRotation?.start(drag.groupId);
}
```

- In `end`, before `onDrop(groupId)`:

```ts
snapRotation?.stop();
```

- In `cancel`, FIRST — before `dragController.cancel()`, whose position-restore fires the `moveGroup` callback and must not trigger an evaluation:

```ts
snapRotation?.stop();
```

3f. Export from `src/interaction/index.ts`:

```ts
export { SnapProximityRotationController } from './snap-proximity-rotation-controller.js';
export type { SnapProximityRotationOptions } from './snap-proximity-rotation-controller.js';
```

- [ ] **Step 4: Run the interaction suites to verify they pass**

Run: `npx vitest run src/interaction/setup-interaction.test.ts src/interaction/snap-proximity-rotation-controller.test.ts`
Expected: PASS — the three new wiring tests and every pre-existing test.

- [ ] **Step 5: Wire `main.ts`**

Add to the `setupInteraction({ ... })` call in `src/main.ts` (after the `onDrop` entry; `getActiveTolerance` / `getActiveRotationTolerance` are already imported):

```ts
getSnapTolerances: () => ({
    tolerancePx: getActiveTolerance(
        gameState.imageSize.width,
        gameState.gridSize.cols,
        gameState.cutStyle,
    ),
    rotationToleranceDeg: getActiveRotationTolerance(),
}),
```

- [ ] **Step 6: Full verification**

Run: `npm test`
Expected: PASS — full suite green.

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/interaction/setup-interaction.ts src/interaction/index.ts src/interaction/setup-interaction.test.ts src/main.ts
git commit -m "feat(interaction): wire snap proximity rotation into drag handling"
```

---

## After the tasks

- The feel of the ramp (spec's "risk to watch") is a subjective call: mechanism-level verification is the test suite; whether it *feels* like magnetic guidance is Adrian's playtest on dev-deploy.
- No help-text or analytics changes are part of this plan (per spec).
