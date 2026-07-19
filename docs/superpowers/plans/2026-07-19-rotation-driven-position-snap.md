# Rotation-Driven Position Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the existing snap-proximity-rotation feature so that, while a group is already inside the snap distance, rotating it toward the correct angle progressively slides it into the correct position — reaching the exact placement at exactly-correct rotation, with the same one-way ratchet.

**Architecture:** A new pure module `snap-proximity-position.ts` computes a translation from the current angular error (positional cap `= D·|θ|/T`, exact at θ=0), reusing the per-gesture `ProximityContext` extracted into a shared `snap-proximity-context.ts`. A sibling `SnapProximityPositionController` mirrors the rotation controller and is driven by the rotate handle's gesture lifecycle (new `onRotateStart`/`onRotateEnd` hooks) plus its existing per-move `onRotate`. Corrections are applied via the `moveGroup` model helper.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (jsdom for DOM tests), Vite.

## Global Constraints

- **American English** for all identifiers, comments, and code artifacts.
- **ESM import specifiers use the `.js` extension** even for `.ts` source (e.g. `import … from './snap-proximity-context.js'`).
- **No new `random()` calls** — this is drag-time interaction, not procedural generation; it must not touch the share-link/save PRNG contract.
- **Free-rotation mode only** — enforced entirely by the reused `buildProximityContext` (returns `null` otherwise); do not add a second gate.
- **Do not change the merge condition** (`|θ| ≤ T` AND `d ≤ D`) or any tolerance/preset. This feature only surfaces the earned snap early.
- Test command: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Full suite: `npm test`.
- Commit after every task (TDD: failing test → implementation → passing test → commit).

---

### Task 1: Extract the shared proximity context module

Pure refactor, no behavior change. Move `SnapTolerances`, `ProximityContext`, `buildProximityContext`, and `clamp01` out of `snap-proximity-rotation.ts` into a new `snap-proximity-context.ts`, and re-export them from the rotation module so every existing importer keeps working unchanged.

**Files:**
- Create: `src/game/snap-proximity-context.ts`
- Modify: `src/game/snap-proximity-rotation.ts`
- Test: existing `src/game/snap-proximity-rotation.test.ts` and `src/interaction/snap-proximity-rotation-controller.test.ts` are the regression guard (no edits).

**Interfaces:**
- Consumes: `getBorderEdges`, `tryGetGroup`, `GroupBorderEdge` from `../model/helpers.js`; `getGroupLocalBounds` from `./group-bounds.js`; `GameState`, `Point` from `../model/types.js`.
- Produces (from `snap-proximity-context.ts`):
  - `export function clamp01(value: number): number`
  - `export interface SnapTolerances { tolerancePx: number; rotationToleranceDeg: number }`
  - `export interface ProximityContext { groupId: number; candidates: GroupBorderEdge[]; centerLocal: Point; tolerancePx: number; rotationToleranceDeg: number }`
  - `export function buildProximityContext(state: GameState, movedGroupId: number, tolerances: SnapTolerances): ProximityContext | null`
  - These same names remain importable from `./snap-proximity-rotation.js` via re-export.

- [ ] **Step 1: Create the shared context module**

Create `src/game/snap-proximity-context.ts` with the definitions moved verbatim from `snap-proximity-rotation.ts` (keep the existing doc comments):

```ts
/**
 * Shared per-gesture context for the snap-proximity features.
 *
 * Both directions of the "close enough to merge" assist — rotation driven by
 * translation (`snap-proximity-rotation.ts`) and translation driven by
 * rotation (`snap-proximity-position.ts`) — operate on the same dragged
 * group against the same border-edge candidates and tolerances. This module
 * owns that shared context so neither feature depends on the other.
 */

import type { GameState, Point } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import type { GroupBorderEdge } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/** Clamp a value to the unit interval [0, 1]. */
export function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * The pair of thresholds that define when a drop would merge — shared by
 * merge detection on drop and the snap-proximity assists during a gesture,
 * so they always agree on what "close enough" means.
 */
export interface SnapTolerances {
    /** Snap distance (D) in world px. */
    tolerancePx: number;
    /** Rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Per-gesture precomputed context. Valid only while the dragged group's
 * composition and every mate group stay unchanged — true for the duration
 * of a single-group gesture, because merges happen only on drop/commit.
 * Build at gesture start, discard on end/cancel.
 */
export interface ProximityContext {
    /** The dragged group. */
    groupId: number;
    /** Border edges of the dragged group and their mates (fixed during a gesture). */
    candidates: GroupBorderEdge[];
    /** Dragged group's bbox center in un-rotated local space — the rotation pivot. */
    centerLocal: Point;
    /** Active snap distance (D) in world px. */
    tolerancePx: number;
    /** Active rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Build the per-gesture context, or `null` when the assist does not apply:
 * not in free-rotation mode, unknown group, no cross-group mates, or a
 * degenerate tolerance. Non-finite tolerances (possible from corrupted
 * saved state upstream) are rejected here so `NaN`/`Infinity` can never
 * flow into the assist math and get persisted onto a group.
 */
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerances: SnapTolerances,
): ProximityContext | null {
    const { tolerancePx, rotationToleranceDeg } = tolerances;
    if (state.rotationMode !== 'free') return null;
    if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return null;
    if (!Number.isFinite(rotationToleranceDeg)) return null;

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

- [ ] **Step 2: Update `snap-proximity-rotation.ts` to import + re-export the shared context**

In `src/game/snap-proximity-rotation.ts`:

1. Remove the local definitions of `clamp01`, `SnapTolerances`, `ProximityContext`, and `buildProximityContext`.
2. Update its imports (it still needs `GameState`, `Point`, `tryGetGroup`, `measureEdgeAlignment`, `SNAP_EPSILON_DEG`). It no longer needs `getBorderEdges`, `GroupBorderEdge`, or `getGroupLocalBounds` directly — remove those imports.
3. Add, near the top after the existing imports:

```ts
import {
    buildProximityContext,
    clamp01,
    type ProximityContext,
    type SnapTolerances,
} from './snap-proximity-context.js';

// Re-exported so existing importers of these symbols from this module keep
// working; their canonical home is now snap-proximity-context.ts.
export { buildProximityContext, clamp01 };
export type { ProximityContext, SnapTolerances };
```

Leave `ROTATION_COMPLETE_AT_FRACTION` and `computeSnapProximityRotation` exactly as they are (they use `clamp01` and `ProximityContext`, now imported).

- [ ] **Step 3: Run the regression suite to verify no behavior change**

Run: `npx vitest run src/game/snap-proximity-rotation.test.ts src/interaction/snap-proximity-rotation-controller.test.ts`
Expected: PASS (all existing cases green — imports resolve through the re-export).

- [ ] **Step 4: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors (main.ts's `import type { SnapTolerances } from './game/snap-proximity-rotation.js'` still resolves via the re-export).

- [ ] **Step 5: Commit**

```bash
git add src/game/snap-proximity-context.ts src/game/snap-proximity-rotation.ts
git commit -m "refactor(snap): extract shared proximity context module"
```

---

### Task 2: `computeSnapProximityPosition` pure function

The core math: given the shared context, return the translation to apply now (or `null`). Positional cap ramps linearly with angular error; full `snapDelta` at θ=0.

**Files:**
- Create: `src/game/snap-proximity-position.ts`
- Test: `src/game/snap-proximity-position.test.ts`

**Interfaces:**
- Consumes: `ProximityContext`, `clamp01` from `./snap-proximity-context.js`; `measureEdgeAlignment` from `./merge-detection.js`; `tryGetGroup` from `../model/helpers.js`; `GameState`, `Point` from `../model/types.js`.
- Produces:
  - `export const SNAP_EPSILON_PX: number`
  - `export function computeSnapProximityPosition(state: GameState, ctx: ProximityContext): Point | null` — the world-space translation to apply via `moveGroup`, or `null` when no correction is due.

- [ ] **Step 1: Write the failing tests**

Create `src/game/snap-proximity-position.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair, makePiece } from '../test-helpers/fixtures.js';
import { buildProximityContext, type ProximityContext } from './snap-proximity-context.js';
import { computeSnapProximityPosition } from './snap-proximity-position.js';
import { getGroup, moveGroup } from '../model/helpers.js';

const D = 40; // tolerancePx (snap distance)
const T = 20; // rotationToleranceDeg (rotation tolerance)
const TOL = { tolerancePx: D, rotationToleranceDeg: T };

function makeGroupOf(id: number, pieceId: number, position: Point, rotation = 0): PieceGroup {
    return { id, pieces: new Map([[pieceId, { x: 0, y: 0 }]]), position, rotation };
}

/**
 * Piece 0 fixed at the origin (group 10); piece 1 in its own group (11),
 * placed by bbox center. Correct placement for group 11 is bbox center
 * (150, 50). `distance` is measured after simulating the rotation snap, so
 * for a group whose bbox center sits at (150 + k, 50) the simulated-snap
 * distance is k regardless of the group's current rotation, and snapDelta ≈
 * (-k, 0).
 */
function makePairState(group1Center: Point, group1Rotation = 0): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, group1Center, group1Rotation);
    return makeGameState({
        pieces: [piece0, piece1],
        groups: [group0, group1],
        rotationMode: 'free',
    });
}

function makeSetup(center: Point, rotation: number): { state: GameState; ctx: ProximityContext } {
    const state = makePairState(center, rotation);
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('computeSnapProximityPosition', () => {
    it('returns null when the group is beyond the snap distance', () => {
        // d = D + 5 = 45 > 40, rotation within tolerance.
        const { state, ctx } = makeSetup({ x: 150 + D + 5, y: 50 }, 5);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('returns null when the rotation is beyond the rotation tolerance', () => {
        // d = 20 (in range), |θ| = T + 5 = 25 > 20.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, T + 5);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('returns null at the rotation-tolerance edge (no jump on entry)', () => {
        // |θ| = T → cap = D = 40 ≥ d = 20 → excess ≤ 0 → nothing to do.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, T);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('translates toward the placement as rotation improves, tracking the cap', () => {
        // d = 20, |θ| = 5 → cap = D·(5/20) = 10 → excess = 10 → factor 0.5.
        // snapDelta ≈ (-20, 0) → translation ≈ (-10, 0).
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const delta = computeSnapProximityPosition(state, ctx);
        expect(delta).not.toBeNull();
        expect(delta!.x).toBeCloseTo(-10);
        expect(delta!.y).toBeCloseTo(0);
    });

    it('applies the full snapDelta at exactly-correct rotation (θ = 0)', () => {
        // cap = 0 → excess = d → factor 1 → full correction to exact placement.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 0);
        const delta = computeSnapProximityPosition(state, ctx);
        expect(delta).not.toBeNull();
        expect(delta!.x).toBeCloseTo(-20);
        expect(delta!.y).toBeCloseTo(0);
    });

    it('is idempotent at rest: re-evaluating after applying the delta returns null', () => {
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const delta = computeSnapProximityPosition(state, ctx)!;
        moveGroup(getGroup(state, 11), delta);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('never moves back as the rotation worsens again (one-way ratchet)', () => {
        // Approach at |θ| = 5 (cap 10): translate from d = 20 down to d = 10.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const group = getGroup(state, 11);
        moveGroup(group, computeSnapProximityPosition(state, ctx)!);
        const heldX = group.position.x;
        expect(heldX).toBeCloseTo(160); // 170 + (-10)

        // Worsen rotation to |θ| = 10 (cap = 20 > current d = 10): held.
        group.rotation = 10;
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
        expect(group.position.x).toBeCloseTo(heldX);
    });

    it.each(['left', 'right'] as const)(
        'the closest qualifying mate wins (%s mate closest)',
        (closest) => {
            const { state, ctx } = makeRowState(closest);
            const delta = computeSnapProximityPosition(state, ctx);
            expect(delta).not.toBeNull();
            // Closest mate at d = 24, cap (|θ| = 8) = D·(8/20) = 16 → excess 8,
            // factor 8/24 = 1/3, |snapDelta| = 24 → |translation| = 8.
            // 'left' pulls toward group 0 (−x); 'right' pulls toward group 2 (+x).
            expect(delta!.x).toBeCloseTo(closest === 'left' ? -8 : 8);
            expect(delta!.y).toBeCloseTo(0);
        },
    );
});

/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, mated along vertical edges. The
 * middle group (11) is rotated 8° (cap = D·8/20 = 16). One mate sits at
 * simulated-snap distance 24 (qualifies, excess 8), the other at 32 (also
 * qualifies, larger excess is NOT chosen). Group 1 is placed to the RIGHT of
 * group 0's alignment (pull −x) and to the LEFT of group 2's alignment (pull
 * +x), so the sign of the returned translation reveals which mate won —
 * discriminating closest-wins from first/last-qualifying-wins bugs.
 *
 * - 'left':  closer to group 0 (d = 24, pull −x); group 2 far (d = 32).
 * - 'right': closer to group 2 (d = 24, pull +x); group 0 far (d = 32).
 */
function makeRowState(closest: 'left' | 'right'): { state: GameState; ctx: ProximityContext } {
    const { piece0, piece1 } = makeMatedPiecePair();
    const rightMate = { id: 2, matePieceId: 2, mateEdgeId: 3, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    piece1.edges[1] = rightMate; // replace the border right edge with a mate to piece 2
    const piece2 = makePiece({ id: 2, edges: [
        { id: 16, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 17, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
        { id: 18, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
        { id: 3, matePieceId: 1, mateEdgeId: 2, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ] });

    // Aligned centers: group 0 → (150, 50); group 2 → (group2.x − 50, 50).
    // 'left':  group1 center x = 174 (d_left = 24), group2 aligned at 206 (d_right = 32).
    // 'right': group1 center x = 182 (d_left = 32), group2 aligned at 206 (d_right = 24).
    const group1CenterX = closest === 'left' ? 174 : 182;
    const group2X = 206 + 50; // group2 aligned center at 206
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, { x: group1CenterX, y: 50 }, 8);
    const group2 = makeGroupOf(12, 2, { x: group2X, y: 0 });
    const state = makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/snap-proximity-position.test.ts`
Expected: FAIL — `computeSnapProximityPosition` / module `./snap-proximity-position.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/game/snap-proximity-position.ts`:

```ts
/**
 * Snap proximity position — progressive translation feedback while rotating.
 *
 * The mirror of `snap-proximity-rotation.ts`. When free rotation is enabled
 * and a group is already within the snap distance of a matching neighbor
 * (a drop would merge), rotating it toward the correct orientation slides it
 * toward the snapped placement: the allowed positional error is capped by a
 * ramp that equals the snap distance at the rotation-tolerance edge (no jump
 * on entry) and reaches zero at exactly-correct rotation (θ = 0), where the
 * full merge correction is applied.
 *
 * One-way by construction: the group's own position is the ratchet's memory.
 * Rotating closer shrinks the cap (translation is applied and persists);
 * rotating away only loosens the cap, which never moves the group back. The
 * rotation gesture pivots on the group's bbox center and `distance` is
 * measured after simulating the rotation snap, so `distance` is invariant to
 * the player's rotation — it responds only to the translation applied here.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group would
 * snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { measureEdgeAlignment } from './merge-detection.js';
import { clamp01, type ProximityContext } from './snap-proximity-context.js';

/**
 * Float-comparison epsilon (world px) for "is this translation effectively
 * zero?" — the positional analog of `SNAP_EPSILON_DEG`. Drives the
 * "already under the cap → return null" short circuit and the one-way
 * ratchet.
 */
export const SNAP_EPSILON_PX = 1e-6;

/**
 * Compute the translation to apply to the group right now, in world px
 * (apply via `moveGroup`), or `null` when no correction is due.
 *
 * A candidate qualifies exactly when a drop would merge it: simulated-snap
 * distance `d ≤ tolerancePx` AND angular error `|θ| ≤ rotationToleranceDeg`.
 * Among qualifying candidates the smallest `d` wins. The correction reduces
 * `d` to a rotation-driven `cap` that equals `tolerancePx` at the
 * rotation-tolerance edge (no jump on entry) and reaches zero at θ = 0,
 * where the full `snapDelta` is applied.
 */
export function computeSnapProximityPosition(
    state: GameState,
    ctx: ProximityContext,
): Point | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    let bestDistance = Infinity;
    let bestSnapDelta: Point = { x: 0, y: 0 };
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
            bestSnapDelta = m.snapDelta;
            bestRotationDelta = m.rotationDelta;
        }
    }
    if (!Number.isFinite(bestDistance)) return null;

    const cap = ctx.tolerancePx *
        clamp01(Math.abs(bestRotationDelta) / ctx.rotationToleranceDeg);
    const excess = bestDistance - cap;
    if (excess <= SNAP_EPSILON_PX) return null;

    // Move along snapDelta so the remaining measured distance is `cap`.
    // excess > 0 here implies bestDistance > cap ≥ 0, so bestDistance > 0.
    const factor = excess / bestDistance;
    return { x: bestSnapDelta.x * factor, y: bestSnapDelta.y * factor };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/snap-proximity-position.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/game/snap-proximity-position.ts src/game/snap-proximity-position.test.ts
git commit -m "feat(snap-position): rotation-driven position snap math"
```

---

### Task 3: `SnapProximityPositionController`

Drag-lifecycle wrapper mirroring `SnapProximityRotationController`: caches the context at gesture start, frame-gates evaluation, applies the translation via `moveGroup`.

**Files:**
- Create: `src/interaction/snap-proximity-position-controller.ts`
- Test: `src/interaction/snap-proximity-position-controller.test.ts`

**Interfaces:**
- Consumes: `buildProximityContext`, `ProximityContext`, `SnapTolerances` from `../game/snap-proximity-context.js`; `computeSnapProximityPosition` from `../game/snap-proximity-position.js`; `moveGroup`, `tryGetGroup` from `../model/helpers.js`; `GameState` from `../model/types.js`.
- Produces:
  - `export interface SnapProximityPositionOptions { getState: () => GameState; getTolerances: () => SnapTolerances; scheduleFrame?: (cb: () => void) => void }`
  - `export class SnapProximityPositionController` with `start(groupId: number): void`, `onGroupRotated(): void`, `stop(): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/interaction/snap-proximity-position-controller.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GameState, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { getGroup } from '../model/helpers.js';
import { SnapProximityPositionController } from './snap-proximity-position-controller.js';

const D = 40;
const T = 20;

/**
 * Pair state: piece 0 fixed near the origin (group 10); piece 1 (group 11)
 * placed by bbox center + rotation. Aligned center for group 11 is (150, 50),
 * so a center at (150 + k, 50) has simulated-snap distance k and
 * snapDelta ≈ (−k, 0).
 */
function makePairState(
    center: Point,
    rotation: number,
    rotationMode: GameState['rotationMode'] = 'free',
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeCenteredGroup(10, 0, { x: 50, y: 50 });
    const group1 = makeCenteredGroup(11, 1, center, rotation);
    return makeGameState({ pieces: [piece0, piece1], groups: [group0, group1], rotationMode });
}

/** Controller wired to a manually flushable frame scheduler. */
function makeController(state: GameState): {
    controller: SnapProximityPositionController;
    flushFrame: () => void;
} {
    let pending: Array<() => void> = [];
    const controller = new SnapProximityPositionController({
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

describe('SnapProximityPositionController', () => {
    it('translates the group toward alignment on rotate', () => {
        // d = 20, |θ| = 5 → cap 10 → excess 10 → move −10 in x.
        // Assert the CHANGE in position.x: makeCenteredGroup positions by bbox
        // center, so the absolute position.x depends on the rotation offset
        // (rotatePoint of the center), but the applied translation is −10.
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.start(11);
        controller.onGroupRotated();

        expect(getGroup(state, 11).position.x - startX).toBeCloseTo(-10);
    });

    it('does nothing before start() or after stop()', () => {
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller, flushFrame } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.onGroupRotated();
        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);

        controller.start(11);
        controller.stop();
        flushFrame();
        controller.onGroupRotated();
        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);
    });

    it('does nothing when rotation mode is not free', () => {
        const state = makePairState({ x: 170, y: 50 }, 5, 'quarter-turn');
        const { controller } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.start(11);
        controller.onGroupRotated();

        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);
    });

    it('evaluates at most once per frame, then resumes after the frame fires', () => {
        // Start at d = 20, |θ| = 5 (cap 10): first eval moves −10 (d → 10).
        // Assert cumulative CHANGE in position.x (absolute value depends on the
        // rotation offset from makeCenteredGroup; the translations do not).
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);
        const startX = group.position.x;

        controller.start(11);
        controller.onGroupRotated();
        expect(group.position.x - startX).toBeCloseTo(-10);

        // Improve rotation to |θ| = 2 (cap 4) but the frame gate is still set.
        group.rotation = 2;
        controller.onGroupRotated();
        expect(group.position.x - startX).toBeCloseTo(-10); // gated: no further move

        flushFrame();
        controller.onGroupRotated(); // evaluates: d 10 → cap 4, move −6 (total −16)
        expect(group.position.x - startX).toBeCloseTo(-16);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/interaction/snap-proximity-position-controller.test.ts`
Expected: FAIL — module/class does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/interaction/snap-proximity-position-controller.ts`:

```ts
/**
 * Gesture-lifecycle wrapper around snap proximity position (the mirror of
 * SnapProximityRotationController).
 *
 * Owns the per-gesture context (built once at rotation start) and frame
 * gating: pointer-move events can outpace the display refresh, so evaluation
 * runs at most once per animation frame. The first rotate in a frame
 * evaluates immediately (no added latency); later rotates in the same frame
 * are skipped. All the geometry lives in `game/snap-proximity-position.ts`.
 *
 * `stop()` only discards the context — translation already applied stays,
 * including on a canceled rotation (it moved toward the correct placement,
 * so keeping it is harmless), mirroring the rotation controller.
 */

import type { GameState } from '../model/types.js';
import { moveGroup, tryGetGroup } from '../model/helpers.js';
import {
    buildProximityContext,
    type ProximityContext,
    type SnapTolerances,
} from '../game/snap-proximity-context.js';
import { computeSnapProximityPosition } from '../game/snap-proximity-position.js';

export interface SnapProximityPositionOptions {
    getState: () => GameState;
    /** Active snap tolerances; read once per gesture, at start(). */
    getTolerances: () => SnapTolerances;
    /** Injectable frame scheduler for tests. Defaults to requestAnimationFrame. */
    scheduleFrame?: (cb: () => void) => void;
}

export class SnapProximityPositionController {
    private ctx: ProximityContext | null = null;
    private gated = false;
    private readonly getState: () => GameState;
    private readonly getTolerances: SnapProximityPositionOptions['getTolerances'];
    private readonly scheduleFrame: (cb: () => void) => void;

    constructor(options: SnapProximityPositionOptions) {
        this.getState = options.getState;
        this.getTolerances = options.getTolerances;
        this.scheduleFrame = options.scheduleFrame
            ?? ((cb) => { requestAnimationFrame(() => cb()); });
    }

    /**
     * Begin tracking a rotation of `groupId`. Cheap no-op context (null)
     * unless the game is in free-rotation mode and the group has cross-group
     * mates.
     */
    start(groupId: number): void {
        this.ctx = buildProximityContext(
            this.getState(), groupId, this.getTolerances(),
        );
        this.gated = false;
    }

    /** Evaluate after the group rotated; at most once per frame. */
    onGroupRotated(): void {
        if (!this.ctx || this.gated) return;
        this.gated = true;
        this.scheduleFrame(() => { this.gated = false; });

        const state = this.getState();
        const delta = computeSnapProximityPosition(state, this.ctx);
        if (delta === null) return;

        const group = tryGetGroup(state, this.ctx.groupId);
        if (group) moveGroup(group, delta);
    }

    /** End tracking (commit or cancel). Translation already applied stays. */
    stop(): void {
        this.ctx = null;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/interaction/snap-proximity-position-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interaction/snap-proximity-position-controller.ts src/interaction/snap-proximity-position-controller.test.ts
git commit -m "feat(snap-position): controller driven by the rotation gesture"
```

---

### Task 4: Rotate-handle `onRotateStart` / `onRotateEnd` hooks

Expose gesture begin/end so the controller can `start()`/`stop()`. `onRotateStart` fires at `pointerdown`; `onRotateEnd` fires whenever a drag finalizes — on commit AND on cancel.

**Files:**
- Modify: `src/ui/rotate-handle.ts`
- Test: `src/ui/rotate-handle.test.ts`

**Interfaces:**
- Produces (additions to `RotateHandleOptions`):
  - `onRotateStart?: (groupId: number) => void`
  - `onRotateEnd?: (groupId: number) => void`

- [ ] **Step 1: Write the failing tests**

In `src/ui/rotate-handle.test.ts`, add `onRotateStart`/`onRotateEnd` spies to the shared harness and three new cases.

First, extend the `describe` block's spy declarations and `beforeEach`:

```ts
    let onRotateStart: ReturnType<typeof vi.fn>;
    let onRotateEnd: ReturnType<typeof vi.fn>;
```

In `beforeEach`, after `onCommit = vi.fn();`:

```ts
        onRotateStart = vi.fn();
        onRotateEnd = vi.fn();
```

In `makeHandle`, add to the `createRotateHandle({ ... })` call (before `...opts`):

```ts
            onRotateStart: onRotateStart as (groupId: number) => void,
            onRotateEnd: onRotateEnd as (groupId: number) => void,
```

Then add the cases:

```ts
    it('calls onRotateStart on pointerdown', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });

        expect(onRotateStart).toHaveBeenCalledWith(0);

        handle.destroy();
    });

    it('calls onRotateEnd on pointerup (commit)', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        dispatchPointerEvent(button, 'pointerup', { clientX: 250, clientY: 150 });

        expect(onRotateEnd).toHaveBeenCalledWith(0);

        handle.destroy();
    });

    it('calls onRotateEnd on pointercancel (no commit)', () => {
        const handle = makeHandle();
        handle.show();
        rotationFocus.setFocus(0);

        const button = container.querySelector('.rotate-handle')! as HTMLButtonElement;
        dispatchPointerEvent(button, 'pointerdown', { clientX: 250, clientY: 150 });
        dispatchPointerEvent(button, 'pointercancel', { clientX: 250, clientY: 150 });

        expect(onRotateEnd).toHaveBeenCalledWith(0);
        expect(onCommit).not.toHaveBeenCalled();

        handle.destroy();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/rotate-handle.test.ts`
Expected: FAIL on the three new cases (`onRotateStart`/`onRotateEnd` never called).

- [ ] **Step 3: Add the hooks to the options interface**

In `src/ui/rotate-handle.ts`, add to `RotateHandleOptions` (after the `onCommit` field):

```ts
    /** Emitted at the start of a rotation drag (pointerdown), before the first onRotate. */
    onRotateStart?: (groupId: number) => void;
    /**
     * Emitted when a rotation drag ends — on commit AND on cancel — after
     * any final onRotate/onCommit. The host stops its per-gesture tracking here.
     */
    onRotateEnd?: (groupId: number) => void;
```

- [ ] **Step 4: Fire `onRotateEnd` in `finalizeDrag`**

In the `finalizeDrag` function, after the commit block and before `startIdleTimer();`:

```ts
            if (commit && groupIdRef !== undefined) {
                options.onCommit(groupIdRef);
            }
            if (groupIdRef !== undefined) {
                options.onRotateEnd?.(groupIdRef);
            }
            startIdleTimer();
```

- [ ] **Step 5: Fire `onRotateStart` in the `pointerdown` handler**

In the `button.addEventListener('pointerdown', …)` handler, after the `drag = { … };` assignment and before `if (active && active.state !== 'visible') rescueActive();`:

```ts
            options.onRotateStart?.(groupId);

```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/ui/rotate-handle.test.ts`
Expected: PASS (existing cases still green, three new cases pass).

- [ ] **Step 7: Commit**

```bash
git add src/ui/rotate-handle.ts src/ui/rotate-handle.test.ts
git commit -m "feat(rotate-handle): add onRotateStart/onRotateEnd gesture hooks"
```

---

### Task 5: Wire the controller into `main.ts`

Instantiate `SnapProximityPositionController` next to the rotate handle and drive it from the handle's lifecycle: `start` on rotate-start, `onGroupRotated` inside `onRotate` (after `rotateGroup`, before `renderState`), `stop` on rotate-end.

The rotate handle rotates only the single focused group (it never co-moves a multi-selection), so — unlike the translation-drag path — no additional single-group guard is needed here; `buildProximityContext` supplies every real guard.

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `SnapProximityPositionController` from `./interaction/snap-proximity-position-controller.js` (or via `./interaction/index.js` if the controller is re-exported there — see Step 1); existing `activeSnapTolerances`, `gameState`, `rotateGroup`, `renderer`, `selectionManager`.

- [ ] **Step 1: Import the controller**

At the top of `src/main.ts`, add an import alongside the other interaction imports:

```ts
import { SnapProximityPositionController } from './interaction/snap-proximity-position-controller.js';
```

(If `SnapProximityRotationController` is imported from `./interaction/index.js`, check whether `index.ts` re-exports controllers; if it does, add `SnapProximityPositionController` to that barrel and import from there instead, matching the existing pattern.)

- [ ] **Step 2: Instantiate the controller before the rotate handle**

Immediately before the `const rotateHandle = createRotateHandle({` line, add:

```ts
const snapPosition = new SnapProximityPositionController({
    getState: () => gameState,
    getTolerances: () => activeSnapTolerances(gameState),
});
```

- [ ] **Step 3: Wire the three lifecycle points into the rotate handle options**

In the `createRotateHandle({ … })` options object:

1. Add a start hook:

```ts
    onRotateStart: (groupId) => {
        snapPosition.start(groupId);
    },
```

2. In the existing `onRotate` callback, insert the evaluation between `rotateGroup(...)` and `renderer.renderState(gameState);`:

```ts
    onRotate: (groupId, deltaDegrees) => {
        if (!gameState) return;
        const group = gameState.groupsById.get(groupId);
        if (!group) return;
        rotateGroup(group, gameState.piecesById, deltaDegrees);
        snapPosition.onGroupRotated();
        renderer.renderState(gameState);
        // Re-apply selection visuals after re-render.
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        // Don't autoSave on every drag tick — autoSave fires on commit.
    },
```

3. Add an end hook (after `onCommit`):

```ts
    onRotateEnd: () => {
        snapPosition.stop();
    },
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/interaction/index.ts
git commit -m "feat(snap-position): drive position snap from the rotate handle"
```

(Only stage `src/interaction/index.ts` if Step 1 modified it.)

---

### Task 6: End-to-end verification and help-text check

No production code beyond what earlier tasks added; this task confirms the feature works in the running app and that the info modal stays correct.

**Files:**
- Possibly modify: `src/ui/info-modal.ts` (only if a sentence becomes wrong — not expected).

- [ ] **Step 1: Confirm the info modal needs no change**

Read `src/ui/info-modal.ts` and check the How-to-Play / Settings copy about rotation and snapping. This feature surfaces the earned snap early without changing the merge outcome — behavior a player would naturally expect — so no new copy is warranted and no existing sentence becomes wrong. Only edit if you find a sentence this makes inaccurate. If you edit, commit with `docs(info-modal): …`; otherwise no commit for this step.

- [ ] **Step 2: Drive the feature in the running app**

Use the `/verify` skill (or the `/run` skill to launch the app). Manually confirm the behavior end-to-end in free-rotation mode:

1. Start a puzzle with free rotation. Move one piece so it is well inside the snap distance of a correct neighbor but clearly rotated off-angle (outside the rotation tolerance).
2. Drag the rotate handle to rotate the piece toward correct. Confirm: nothing moves until the rotation enters the tolerance and the cap drops below the current distance; then the piece slides toward the correct position; at exactly-correct rotation it sits in the exact position.
3. Rotate back away from correct. Confirm the piece does NOT slide back out (one-way ratchet).
4. Release. Confirm it merges (drop/commit merge detection unchanged).

Because "slides into place" is a subjective/aesthetic quality, treat "runs without error and ratchets correctly" as the pass bar here and defer the final feel judgment to the user.

- [ ] **Step 3: Report verification results**

Summarize what was exercised and observed. Do not claim completion beyond what was actually driven. Flag the feel judgment for the user.

---

## Notes for the implementer

- **Reproducibility contract:** this feature consumes no `random()`, so share links and saves are unaffected — nothing to isolate behind a sub-PRNG.
- **No re-entrancy:** the controller applies corrections via the `moveGroup` *model helper* (`src/model/helpers.ts`), not the interaction-layer `moveGroup` callback, so it never triggers `snapRotation.onGroupMoved()`.
- **Why `distance` is invariant to the player's rotation:** the rotate handle pivots on the group's bbox center and `measureEdgeAlignment` measures distance after simulating the rotation snap, so rotating never changes `distance` — only this feature's translation does. That is what makes the axes independent and the ratchet stable.
