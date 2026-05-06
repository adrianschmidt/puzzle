# Rotation-as-degrees refactor — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the engine from quarter-turn integer rotations (`0|1|2|3`) to float-degrees (`number`, 0–360), with no user-visible change. This is the foundation for the free-rotation feature in a follow-up plan.

**Architecture:** `PieceGroup.rotation` becomes `number` (float degrees). `rotateGroup` switches from a `'cw' | 'ccw'` direction parameter to a `deltaDegrees: number` parameter. `rotatePoint` accepts degrees and uses `Math.cos` / `Math.sin` directly. Save-format gets a v9 schema that stores rotation as degrees; the v8 → v9 migration multiplies stored values by 90. The share-link wire format is **unchanged** (still encodes quarter-turn integers); the encoder divides by 90 before serializing, the decoder multiplies by 90 after parsing.

**Tech Stack:** TypeScript, Vitest, Vite. Tests run with `npm test`. The test runner is Vitest (see `package.json`); use `npx vitest run <file>` to run a single test file.

**See:** `docs/superpowers/specs/2026-05-06-free-rotation-design.md` for the broader design.

---

## File map

**Modify:**
- `src/model/types.ts` — change `rotation: 0|1|2|3` to `rotation: number`.
- `src/model/helpers.ts` — add `normaliseDegrees`; change `rotatePoint` to take degrees; remove `normaliseQuarterTurns` (last cleanup task).
- `src/game/rotate-group.ts` — signature change to `deltaDegrees: number`; remove `RotationDirection` (move to `rotate-buttons.ts`).
- `src/game/init.ts` — `pickInitialRotation` returns degrees `{0, 90, 180, 270}`.
- `src/game/group-merging.ts` — replace inverse-quarter-turn math with degrees.
- `src/game/merge-detection.ts` — rotation gate compares degrees (still exact equality in this PR).
- `src/renderer/svg-dom-renderer.ts` — drop the `* 90` factor.
- `src/sharing/share-link.ts` — encoder divides by 90, decoder multiplies by 90.
- `src/sharing/reconstruct-groups.ts` — multiplies decoded rotation by 90.
- `src/persistence/serialization.ts` — bump `STATE_VERSION` to 9; v ≤ 8 → multiply by 90 on load.
- `src/main.ts` — `onRotate` callback maps `'cw' | 'ccw'` to `±90`; `__solvePuzzle` and `zoomToFitCompletedPuzzle` adjust to degrees.
- `src/ui/rotate-buttons.ts` — own the `RotationDirection` type (still emits `'cw' | 'ccw'`).
- All test files using literal `rotation: 0|1|2|3` — update to degrees.

**Create:** None.

**Test:**
- New tests for `normaliseDegrees` in `src/model/helpers.test.ts` (create if not present).
- All existing tests asserting rotation as `0/1/2/3` need to be re-asserted as `0/90/180/270`.

---

## Task 1: Add `normaliseDegrees` helper

**Files:**
- Modify: `src/model/helpers.ts`
- Test: `src/model/helpers.test.ts` (create if missing — check first)

- [ ] **Step 1: Check whether the test file exists**

```bash
ls src/model/helpers.test.ts 2>/dev/null && echo EXISTS || echo CREATE
```

If `EXISTS`: append the new `describe` block to the existing file. If `CREATE`: create a new file with the standard imports.

- [ ] **Step 2: Write the failing test**

If creating new, use this skeleton; otherwise append the `describe` block:

```ts
import { describe, it, expect } from 'vitest';
import { normaliseDegrees } from './helpers.js';

describe('normaliseDegrees', () => {
    it('returns values in [0, 360) for any input', () => {
        expect(normaliseDegrees(0)).toBe(0);
        expect(normaliseDegrees(90)).toBe(90);
        expect(normaliseDegrees(360)).toBe(0);
        expect(normaliseDegrees(720)).toBe(0);
        expect(normaliseDegrees(-90)).toBe(270);
        expect(normaliseDegrees(-450)).toBe(270);
    });

    it('preserves fractional values', () => {
        expect(normaliseDegrees(47.3)).toBeCloseTo(47.3);
        expect(normaliseDegrees(360.5)).toBeCloseTo(0.5);
        expect(normaliseDegrees(-0.5)).toBeCloseTo(359.5);
    });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: tests fail with `normaliseDegrees is not a function` (or import error).

- [ ] **Step 4: Implement `normaliseDegrees`**

Add to `src/model/helpers.ts` (keep `normaliseQuarterTurns` for now — removed in a later task):

```ts
/**
 * Normalise an unbounded degrees value into the range [0, 360).
 *
 * Accepts negative or large positive inputs and returns a non-negative
 * value strictly less than 360. Preserves fractional precision.
 */
export function normaliseDegrees(deg: number): number {
    return ((deg % 360) + 360) % 360;
}
```

- [ ] **Step 5: Run test, verify it passes**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/helpers.ts src/model/helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(helpers): add normaliseDegrees helper

Foundation for the rotation-as-degrees refactor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Convert `rotatePoint` to accept float degrees

**Files:**
- Modify: `src/model/helpers.ts:178-185`
- Test: any test file calling `rotatePoint`

`rotatePoint` is currently the only consumer of the quarter-turn integer; converting it to degrees is what unblocks the rest of the refactor.

- [ ] **Step 1: Find every direct call site of `rotatePoint`**

```bash
grep -rn "rotatePoint" src --include='*.ts'
```

Note the call sites (typically: `helpers.ts` itself, `rotate-group.ts`, `main.ts`). Each must keep producing the same world-space result after the change.

- [ ] **Step 2: Write failing tests for the new degrees-based `rotatePoint`**

Append to `src/model/helpers.test.ts`:

```ts
import { rotatePoint } from './helpers.js';

describe('rotatePoint (degrees)', () => {
    it('handles the four canonical quarter-turn angles', () => {
        const p = { x: 1, y: 0 };
        expect(rotatePoint(p, 0)).toEqual({ x: 1, y: 0 });
        expect(rotatePoint(p, 90)).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(1) });
        expect(rotatePoint(p, 180)).toMatchObject({ x: expect.closeTo(-1), y: expect.closeTo(0) });
        expect(rotatePoint(p, 270)).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(-1) });
    });

    it('handles non-quarter-turn angles', () => {
        const p = { x: 1, y: 0 };
        const r = rotatePoint(p, 47);
        expect(r.x).toBeCloseTo(Math.cos((47 * Math.PI) / 180));
        expect(r.y).toBeCloseTo(Math.sin((47 * Math.PI) / 180));
    });

    it('handles negative and >360° inputs (no normalisation needed at this layer)', () => {
        const p = { x: 1, y: 0 };
        // -90° == +270°
        const a = rotatePoint(p, -90);
        const b = rotatePoint(p, 270);
        expect(a.x).toBeCloseTo(b.x);
        expect(a.y).toBeCloseTo(b.y);
    });
});
```

`closeTo` matcher: vitest provides `toBeCloseTo` on numbers, but `expect.closeTo` for use inside `objectContaining`-style matchers; if your vitest version lacks `expect.closeTo` for object assertions, switch to splitting the assertion into `toBeCloseTo` calls per axis.

- [ ] **Step 3: Run, verify failing**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: failing — old `rotatePoint` only accepts `0 | 1 | 2 | 3` and treats `90` as out-of-domain.

- [ ] **Step 4: Replace the implementation**

In `src/model/helpers.ts`, replace the existing `rotatePoint` with:

```ts
/**
 * Rotate a point by `degrees` clockwise around the origin.
 *
 * Used for converting between a group's un-rotated local space and its
 * rotated world projection. Accepts any float (positive, negative, or out
 * of `[0, 360)` range) — callers that need a normalised group rotation
 * should pass values through `normaliseDegrees` themselves.
 */
export function rotatePoint(point: Point, degrees: number): Point {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        x: point.x * cos - point.y * sin,
        y: point.x * sin + point.y * cos,
    };
}
```

(The `x cos − y sin, x sin + y cos` form gives the same clockwise rotation in screen coordinates as the previous `quarterTurns` switch — verify by spot-checking against the canonical mappings in the test.)

Note: `localToWorld` and `getWorldPosition` immediately below `rotatePoint` keep their bodies — they pass `group.rotation` straight through — but `group.rotation` is now `number`, which is still a valid input to the new signature once Task 4 lands. There's a transient TypeScript error window between Task 2 and Task 4: keep going.

- [ ] **Step 5: Run helpers tests, verify they pass**

```bash
npx vitest run src/model/helpers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/helpers.ts src/model/helpers.test.ts
git commit -m "$(cat <<'EOF'
refactor(helpers): rotatePoint accepts float degrees

Switches from a quarterTurns: 0|1|2|3 enum to a degrees: number
parameter. Uses Math.cos/Math.sin directly. Behaviour at the
canonical {0, 90, 180, 270} angles is identical.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Widen `PieceGroup.rotation` type to `number`

**Files:**
- Modify: `src/model/types.ts:83`

Pure type change. No runtime effect. Compilation will fail in places where the narrower type was relied on; fixed in subsequent tasks.

- [ ] **Step 1: Edit the type**

In `src/model/types.ts`, change:

```ts
    rotation: 0 | 1 | 2 | 3;
```

to:

```ts
    /**
     * Rotation in float degrees, normalised to `[0, 360)`.
     *
     * Quarter-turn-mode puzzles store one of `{0, 90, 180, 270}`; free-mode
     * puzzles store any float in the range. Applied to the group's local
     * geometry at render time and during world-position lookups. Piece
     * offsets and edge endpoints stay in un-rotated local coordinates.
     *
     * Surfaces in the UI for puzzle styles that enable rotation (currently
     * any cut style with `rotationMode !== 'none'`); puzzles with
     * `rotationMode === 'none'` always have 0.
     */
    rotation: number;
```

- [ ] **Step 2: Run typecheck and tests**

```bash
npm run build 2>&1 | head -50
```

Expected: many TypeScript errors in tests / consumers that asserted the narrower type — these are addressed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/model/types.ts
git commit -m "$(cat <<'EOF'
refactor(types): widen PieceGroup.rotation to number (degrees)

Type change only; runtime behaviour is unchanged because all current
producers of rotation values are still emitting integers in 0|1|2|3.
Consumers will be migrated to the degrees representation in
follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Refactor `rotateGroup` to take `deltaDegrees`

**Files:**
- Modify: `src/game/rotate-group.ts`
- Modify: `src/main.ts:761-774` (the `onRotate` callback that calls `rotateGroup`)
- Modify: `src/ui/rotate-buttons.ts` (owns `RotationDirection` from now on)
- Test: `src/game/rotate-group.test.ts`

- [ ] **Step 1: Update the test fixtures and assertions**

Open `src/game/rotate-group.test.ts` and replace:

```ts
// before
import { rotateGroup } from './rotate-group.js';
// ...tests use rotateGroup(group, p, 'cw') and assert rotation === 0|1|2|3
```

with new tests that exercise the `deltaDegrees` API:

```ts
import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup } from '../model/types.js';
import { rotateGroup } from './rotate-group.js';
import { getGroupLocalBounds } from './group-bounds.js';
import { buildPiecesById } from '../test-helpers/fixtures.js';

function makeEdge(id: number, sx: number, sy: number, ex: number, ey: number): Edge {
    return { id, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

function makeSquarePiece(id: number): Piece {
    return {
        id,
        edges: [
            makeEdge(id * 10, 0, 0, 100, 0),
            makeEdge(id * 10 + 1, 100, 0, 100, 100),
            makeEdge(id * 10 + 2, 100, 100, 0, 100),
            makeEdge(id * 10 + 3, 0, 100, 0, 0),
        ],
        shape: '',
        imageOffset: { x: 0, y: 0 },
    };
}

describe('rotateGroup', () => {
    it('rotates by +90° and normalises into [0, 360)', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 270,
        };

        rotateGroup(group, buildPiecesById([piece]), 90);
        expect(group.rotation).toBe(0);
    });

    it('rotates by -90° and wraps 0 → 270', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        rotateGroup(group, buildPiecesById([piece]), -90);
        expect(group.rotation).toBe(270);
    });

    it('accepts non-quarter-turn deltas (e.g. 47°)', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        rotateGroup(group, buildPiecesById([piece]), 47);
        expect(group.rotation).toBeCloseTo(47);
    });

    it('preserves the world-space bbox centre across a +90° rotation', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };

        const bounds = getGroupLocalBounds(group, buildPiecesById([piece]));
        const worldCentreBefore = {
            x: group.position.x + bounds.minX + bounds.width / 2,
            y: group.position.y + bounds.minY + bounds.height / 2,
        };

        rotateGroup(group, buildPiecesById([piece]), 90);

        // bounds.{minX,minY,width,height} live in un-rotated local space and
        // do not change. Compute the new world centre directly:
        // worldCentreAfter = position + rotate(centre_local, 90°)
        const localCentre = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        // 90° CW rotation: (x,y) → (-y, x)
        const rotated = { x: -localCentre.y, y: localCentre.x };
        const worldCentreAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCentreAfter.x).toBeCloseTo(worldCentreBefore.x);
        expect(worldCentreAfter.y).toBeCloseTo(worldCentreBefore.y);
    });

    it('is inverse-consistent: +90 then -90 returns to the starting state', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        rotateGroup(group, buildPiecesById([piece]), 90);
        rotateGroup(group, buildPiecesById([piece]), -90);

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('four +90° rotations restore rotation and position', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        for (let i = 0; i < 4; i++) rotateGroup(group, buildPiecesById([piece]), 90);

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('handles multi-piece groups by pivoting around the combined bbox centre', () => {
        const p0 = makeSquarePiece(0);
        const p1 = makeSquarePiece(1);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 500, y: 500 },
            rotation: 0,
        };

        const boundsBefore = getGroupLocalBounds(group, buildPiecesById([p0, p1]));
        const worldCentreBefore = {
            x: group.position.x + boundsBefore.minX + boundsBefore.width / 2,
            y: group.position.y + boundsBefore.minY + boundsBefore.height / 2,
        };

        rotateGroup(group, buildPiecesById([p0, p1]), 90);

        const localCentre = {
            x: boundsBefore.minX + boundsBefore.width / 2,
            y: boundsBefore.minY + boundsBefore.height / 2,
        };
        const rotated = { x: -localCentre.y, y: localCentre.x };
        const worldCentreAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCentreAfter.x).toBeCloseTo(worldCentreBefore.x);
        expect(worldCentreAfter.y).toBeCloseTo(worldCentreBefore.y);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail with the current API**

```bash
npx vitest run src/game/rotate-group.test.ts
```

Expected: failing — current implementation only accepts `'cw' | 'ccw'`.

- [ ] **Step 3: Replace the `rotateGroup` implementation**

Edit `src/game/rotate-group.ts` to:

```ts
/**
 * Pivot-preserving group rotation by an arbitrary degrees delta.
 *
 * Rotation is stored on `PieceGroup.rotation` as float degrees, normalised
 * to `[0, 360)`. Piece offsets stay in un-rotated local space; rotation is
 * applied at render time and via `getWorldPosition`. When we change a
 * group's rotation, we adjust its `position` so the group's visual bbox
 * centre stays anchored in world space.
 */

import type { Piece, PieceGroup } from '../model/types.js';
import { normaliseDegrees, rotatePoint } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Rotate a group by `deltaDegrees` clockwise (negative for counter-clockwise),
 * keeping the group's visual bbox centre fixed in world space.
 *
 * Mutates `group.rotation` and `group.position`. Returns the same group.
 */
export function rotateGroup(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    deltaDegrees: number,
): PieceGroup {
    const oldRotation = group.rotation;
    const newRotation = normaliseDegrees(oldRotation + deltaDegrees);

    const bounds = getGroupLocalBounds(group, piecesById);
    const centreLocal = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };

    // Preserve world-space centre: position' + R_new(C) = position + R_old(C)
    const rotatedOld = rotatePoint(centreLocal, oldRotation);
    const rotatedNew = rotatePoint(centreLocal, newRotation);
    group.position = {
        x: group.position.x + rotatedOld.x - rotatedNew.x,
        y: group.position.y + rotatedOld.y - rotatedNew.y,
    };
    group.rotation = newRotation;

    return group;
}
```

(`RotationDirection` is no longer exported from this module — remove the export. The next sub-step moves it to where it's still used.)

- [ ] **Step 4: Move `RotationDirection` to `rotate-buttons.ts`**

Edit `src/ui/rotate-buttons.ts`:

```ts
// Replace the existing import:
import type { RotationDirection } from '../game/rotate-group.js';

// with a local declaration:
export type RotationDirection = 'cw' | 'ccw';
```

(The rest of the file is unchanged. The `RotateButtonsOptions.onRotate` callback signature already uses `RotationDirection`; it now points to the local declaration.)

- [ ] **Step 5: Update `main.ts` `onRotate` to map direction → ±90 degrees**

Edit `src/main.ts:761-774`:

```ts
// before
onRotate: (groupId, direction) => {
    if (!gameState) return;
    const group = gameState.groupsById.get(groupId);
    if (!group) return;

    rotateGroup(group, gameState.piecesById, direction);
    // ...
},

// after
onRotate: (groupId, direction) => {
    if (!gameState) return;
    const group = gameState.groupsById.get(groupId);
    if (!group) return;

    const deltaDeg = direction === 'cw' ? 90 : -90;
    rotateGroup(group, gameState.piecesById, deltaDeg);
    // ...
},
```

- [ ] **Step 6: Run rotate-group tests, verify they pass**

```bash
npx vitest run src/game/rotate-group.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/game/rotate-group.ts src/game/rotate-group.test.ts src/ui/rotate-buttons.ts src/main.ts
git commit -m "$(cat <<'EOF'
refactor(rotate-group): accept deltaDegrees instead of cw/ccw direction

The function generalises trivially from quarter-turns to arbitrary
float deltas: the bbox-centre-preserving math doesn't depend on the
delta size. Quarter-turn callers in main.ts now translate the
'cw'/'ccw' UI concept to ±90 at the call site. RotationDirection
moves to rotate-buttons.ts where it remains a UI-level concept.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `init.ts` to pick rotations from `{0, 90, 180, 270}`

**Files:**
- Modify: `src/game/init.ts:134-137`
- Test: `src/game/init.test.ts`

- [ ] **Step 1: Update the test assertions**

In `src/game/init.test.ts`, find the `describe('rotationMode', ...)` block and update the three tests that assert `[0, 1, 2, 3]`:

```ts
// In each of:
//   - "assigns random quarter-turn rotations when rotationMode is 'quarter-turn'"
//   - "assigns random rotations to classic-cut puzzles..."
//   - "assigns random rotations to composable-cut puzzles..."

for (const group of state.groups) {
    expect([0, 90, 180, 270]).toContain(group.rotation);
}
```

(The "at least one group has non-zero rotation" line stays unchanged — `g.rotation !== 0` works for both representations.)

- [ ] **Step 2: Run tests, verify failure**

```bash
npx vitest run src/game/init.test.ts
```

Expected: failing on the `[0, 90, 180, 270]` checks.

- [ ] **Step 3: Update the implementation**

Edit `src/game/init.ts:134-137`:

```ts
// before
const pickInitialRotation: () => 0 | 1 | 2 | 3 =
    options.rotationMode === 'quarter-turn'
        ? () => Math.floor(random() * 4) as 0 | 1 | 2 | 3
        : () => 0;

// after
const pickInitialRotation: () => number =
    options.rotationMode === 'quarter-turn'
        ? () => Math.floor(random() * 4) * 90
        : () => 0;
```

- [ ] **Step 4: Run tests, verify passing**

```bash
npx vitest run src/game/init.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/init.ts src/game/init.test.ts
git commit -m "$(cat <<'EOF'
refactor(init): pick initial rotations from {0, 90, 180, 270}

Rotation values are now stored as float degrees throughout the
engine. Quarter-turn-mode init still picks one of four discrete
values; only the unit changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update `group-merging.ts` inverse-rotation math

**Files:**
- Modify: `src/game/group-merging.ts:60-69`
- Test: `src/game/group-merging.test.ts`

The inverse-rotation step transforms a world-space delta into the target group's un-rotated local space so piece offsets line up. Currently it computes `inverseTurns = 4 - targetGroup.rotation`. With degrees: `inverseDeg = 360 - targetGroup.rotation`.

- [ ] **Step 1: Look at the current test assertions**

```bash
grep -n "rotation" src/game/group-merging.test.ts | head
```

Update any assertions that hard-code `rotation: 1|2|3` or expected rotations to use the degrees equivalents (`90`/`180`/`270`).

- [ ] **Step 2: Update the implementation**

Edit `src/game/group-merging.ts`:

```ts
// before
import {
    getGroup,
    moveGroup,
    normaliseQuarterTurns,
    removeGroup,
    rotatePoint,
} from '../model/helpers.js';

// after
import {
    getGroup,
    moveGroup,
    normaliseDegrees,
    removeGroup,
    rotatePoint,
} from '../model/helpers.js';
```

And replace the `inverseTurns` block:

```ts
// before
const inverseTurns = normaliseQuarterTurns(4 - targetGroup.rotation);
const localDelta = rotatePoint(rawDiff, inverseTurns);

// after
const inverseDeg = normaliseDegrees(-targetGroup.rotation);
const localDelta = rotatePoint(rawDiff, inverseDeg);
```

Update the comment block above (`Both groups share the same rotation (the mate gate ensures this)`) — leave the prose alone; rewrite only the value `inverseTurns` references.

- [ ] **Step 3: Run group-merging tests**

```bash
npx vitest run src/game/group-merging.test.ts
```

Expected: PASS (tests previously assertions hardcoded only quarter-turn integers — once those are updated to degrees, behaviour matches).

- [ ] **Step 4: Commit**

```bash
git add src/game/group-merging.ts src/game/group-merging.test.ts
git commit -m "$(cat <<'EOF'
refactor(group-merging): inverse rotation in degrees

Replaces the quarter-turn arithmetic (4 - rotation) with the
degrees equivalent (-rotation, normalised). Behaviour at the four
canonical rotations is identical.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `merge-detection.ts` rotation gate

**Files:**
- Modify: `src/game/merge-detection.ts:76`

The gate is exact equality already and stays exact equality in this PR — only the values stored on `rotation` have changed. No code change is required here, but verify the test file's hard-coded rotation values are updated.

- [ ] **Step 1: Inspect the file for hard-coded rotation literals**

```bash
grep -n "rotation:" src/game/merge-detection.test.ts | head -30
```

If any assertions hard-code `rotation: 1|2|3`, replace with the degrees equivalent.

- [ ] **Step 2: Run the merge-detection tests**

```bash
npx vitest run src/game/merge-detection.test.ts
```

Expected: PASS. If any failures, they reveal hard-coded quarter-turn values that still need updating.

- [ ] **Step 3: Commit any test changes**

```bash
git add src/game/merge-detection.test.ts
git commit -m "$(cat <<'EOF'
test(merge-detection): use degrees in fixtures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Skip the commit if no changes were needed.)

---

## Task 8: Update the renderer's transform

**Files:**
- Modify: `src/renderer/svg-dom-renderer.ts:244`
- Test: `src/renderer/svg-dom-renderer.test.ts`

- [ ] **Step 1: Update the production code**

In `src/renderer/svg-dom-renderer.ts:244`:

```ts
// before
const rotateDeg = group.rotation * 90;

// after
const rotateDeg = group.rotation;
```

- [ ] **Step 2: Update tests in `svg-dom-renderer.test.ts`**

```bash
grep -n "rotation" src/renderer/svg-dom-renderer.test.ts
```

Any test that constructs a fixture group with `rotation: 1|2|3` and asserts a CSS transform must update both the fixture (use `90`/`180`/`270`) AND the asserted `rotate(...)` value (which becomes the same number).

- [ ] **Step 3: Run renderer tests**

```bash
npx vitest run src/renderer/svg-dom-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/svg-dom-renderer.ts src/renderer/svg-dom-renderer.test.ts
git commit -m "$(cat <<'EOF'
refactor(renderer): drop the *90 factor from group rotation

group.rotation is now in degrees directly; the CSS transform
takes degrees, so the multiplication is no longer needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update `main.ts` debug helpers

**Files:**
- Modify: `src/main.ts` (`__solvePuzzle`, `zoomToFitCompletedPuzzle`)

- [ ] **Step 1: `__solvePuzzle` already uses `rotation: 0`**

No change needed — `0` is valid in both representations. Verify by reading line 358.

- [ ] **Step 2: `zoomToFitCompletedPuzzle` rotation reset**

In `src/main.ts:262-274`, the function rotates the completed group back to `0`. The math uses `rotatePoint(centreLocal, completedGroup.rotation)` (single arg, was quarter-turns; now degrees — already correct after Task 2). The reassignment `completedGroup.rotation = 0` is a no-unit literal — also fine.

The block is already correct under the new degrees semantics. Skip if no change is needed.

- [ ] **Step 3: Verify by running build**

```bash
npm run build
```

Expected: clean build (any remaining errors point to test fixtures still using narrow types — fixed in Task 13).

- [ ] **Step 4: Commit any changes**

If no production changes were needed, skip the commit. Otherwise:

```bash
git add src/main.ts
git commit -m "..."
```

---

## Task 10: Save-format migration v8 → v9

**Files:**
- Modify: `src/persistence/serialization.ts`
- Test: `src/persistence/serialization.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/persistence/serialization.test.ts`:

```ts
describe('rotation degrees migration (v8 → v9)', () => {
    it('migrates v8 saves with quarter-turn rotation values to degrees', () => {
        const v8Save: SerializedGameState = {
            // Reuse the helper that builds a minimal valid save in this test
            // file (look up the existing fixture pattern in the file). Set:
            version: 8,
            // ...required fields...
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 0 },
                { id: 1, pieces: [[1, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 1 },
                { id: 2, pieces: [[2, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 2 },
                { id: 3, pieces: [[3, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 3 },
            ],
            // ...rest...
        };

        const state = deserializeState(v8Save);

        expect(state.groups.find((g) => g.id === 0)!.rotation).toBe(0);
        expect(state.groups.find((g) => g.id === 1)!.rotation).toBe(90);
        expect(state.groups.find((g) => g.id === 2)!.rotation).toBe(180);
        expect(state.groups.find((g) => g.id === 3)!.rotation).toBe(270);
    });

    it('passes through v9 saves with rotation already in degrees', () => {
        const v9Save: SerializedGameState = {
            version: 9,
            // ...required fields...
            groups: [
                { id: 0, pieces: [[0, { x: 0, y: 0 }]], position: { x: 0, y: 0 }, rotation: 47.3 },
            ],
            // ...rest...
        };

        const state = deserializeState(v9Save);
        expect(state.groups[0].rotation).toBeCloseTo(47.3);
    });
});
```

(Inspect `serialization.test.ts` to copy the existing minimal-save fixture pattern; the test runner needs all required fields populated.)

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/persistence/serialization.test.ts
```

Expected: failing — current code applies no degrees conversion.

- [ ] **Step 3: Update `serialization.ts`**

Make these three edits:

(a) Bump the version constant and supported list:

```ts
export const STATE_VERSION = 9;

const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
```

(b) Update the version-history comment block:

```ts
/**
 * Supported schema versions.
 *
 * - v1: original format (no imageSize or attribution)
 * - v2: adds imageSize and optional attribution
 * - v3: adds gridSize (cols × rows)
 * - v4: adds seed for procedural cut generation
 * - v5: adds cutStyle ('classic' | 'fractal')
 * - v6: adds rotation (0-3 quarter-turns) per group
 * - v7: adds generatorConfig (fractal/composable params) for reproducibility
 * - v8: replaces opaque generatorConfig with typed composableConfig / fractalConfig
 * - v9: rotation is stored in float degrees (0–360); v8 and earlier saves are
 *       migrated by multiplying their integer quarter-turn values by 90
 */
```

(c) Update `normaliseStoredRotation` to allow numbers and add a degrees migration in `deserializeState`. Replace the helper:

```ts
/**
 * v5 and earlier saves have no rotation; coerce unknown values to 0.
 *
 * Returns the raw stored value (either quarter-turns for v ≤ 8 saves or
 * degrees for v ≥ 9 saves). The caller is responsible for converting
 * quarter-turn-era values to degrees by multiplying by 90.
 */
function normaliseStoredRotation(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return 0;
}
```

And in `deserializeState`, after `const groups = data.groups.map(deserializeGroup);`, add:

```ts
// v8 and earlier stored rotation as quarter-turn count {0,1,2,3}; v9+
// stores it as float degrees. Migrate older saves by multiplying.
if (data.version <= 8) {
    for (const group of groups) {
        group.rotation = group.rotation * 90;
    }
}
```

Also update the `resolveRotationMode` helper's `groups.some((g) => g.rotation !== 0)` check — it still works (any non-zero degrees value fires it just as any non-zero quarter-turn did).

(d) Update the `SerializedPieceGroup.rotation` jsdoc:

```ts
    /**
     * Rotation. v9+ saves store float degrees in `[0, 360)`; v6–v8 stored
     * quarter-turn count `{0, 1, 2, 3}` and are migrated on load. Missing
     * on v5 and earlier saves.
     */
    rotation?: number;
```

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/persistence/serialization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): migrate v8 saves to v9 (rotation in degrees)

v9 saves store rotation as float degrees in [0, 360). v8 and
earlier saves stored a quarter-turn count {0,1,2,3}; on load,
those values are multiplied by 90 to produce the degrees
equivalent. The v8 and v9 representations are visually identical
for quarter-turn-mode puzzles, so no player-visible change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Share-link backward-compat shim

**Files:**
- Modify: `src/sharing/share-link.ts:191-201`
- Modify: `src/game/reconstruct-groups.ts` (the v1 share decoder applying `pr` progress)

The share-link wire format **stays the same** — `mr` and `sr` continue to encode quarter-turn integers `0..3` for backward compatibility with existing shared links. The encoder divides by 90 to produce that; the decoder multiplies by 90 to restore degrees. (The wire format will be properly extended in PR 2.)

- [ ] **Step 1: Update the encoder**

In `src/sharing/share-link.ts:191-201`:

```ts
// before
if (state.rotationMode === 'quarter-turn') {
    pr.mr = merged.map((g) => g.rotation);
    const sr: number[] = [];
    for (const g of state.groups) {
        if (g.pieces.size !== 1) continue;
        if (g.rotation === 0) continue;
        const [pieceId] = g.pieces.keys();
        sr.push(pieceId, g.rotation);
    }
    if (sr.length > 0) pr.sr = sr;
}

// after
if (state.rotationMode === 'quarter-turn') {
    // Wire format for v: 1 share links is quarter-turn integers 0..3,
    // matching what existing shared URLs in the wild encode. The internal
    // representation switched to degrees in the rotation-as-degrees
    // refactor, so we divide by 90 here.
    pr.mr = merged.map((g) => Math.round(g.rotation / 90));
    const sr: number[] = [];
    for (const g of state.groups) {
        if (g.pieces.size !== 1) continue;
        if (g.rotation === 0) continue;
        const [pieceId] = g.pieces.keys();
        sr.push(pieceId, Math.round(g.rotation / 90));
    }
    if (sr.length > 0) pr.sr = sr;
}
```

- [ ] **Step 2: Find the decode site**

```bash
grep -n "pr\.mr\|payload\.pr\|progress\.mr" src/game/reconstruct-groups.ts
```

The progress applier reads `mr` and `sr` and assigns to `group.rotation`. Update those assignments to multiply by 90.

- [ ] **Step 3: Update `reconstruct-groups.ts`**

In every place where `mr[i]` or a paired `sr` value is assigned to a group's `rotation`, multiply by 90:

```ts
// before
group.rotation = mr[i] as 0 | 1 | 2 | 3;

// after
// Wire format is quarter-turn integer; convert to degrees.
group.rotation = (mr[i] ?? 0) * 90;
```

(Apply the same conversion to the solo-piece `sr` decoding.)

- [ ] **Step 4: Update share-link tests**

In `src/sharing/share-link.test.ts`, fixtures that build a quarter-turn `GameState` must now use degrees for the in-memory `rotation` (e.g. `rotation: 1` becomes `rotation: 90`) — but assertions on the encoded `mr` and `sr` still check for quarter-turn integers (because the wire format hasn't changed). Walk through each test and update both sides.

- [ ] **Step 5: Run share-link tests**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sharing/share-link.ts src/game/reconstruct-groups.ts src/sharing/share-link.test.ts
git commit -m "$(cat <<'EOF'
refactor(share-link): translate degrees ↔ quarter-turn at the boundary

The wire format stays at v: 1 (quarter-turn integers 0..3) so
existing shared URLs continue to load. Encoder divides g.rotation
by 90; decoder (reconstruct-groups) multiplies the wire value by
90. Free-rotation will introduce a v: 2 schema in a follow-up
that encodes degrees directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Sweep remaining hard-coded rotation literals

**Files:**
- Various test files

- [ ] **Step 1: Search for remaining quarter-turn literals**

```bash
grep -rn "rotation: [123]\b" src --include='*.ts'
grep -rn "rotation\s*:\s*[123]\b" src --include='*.ts'
```

Each match in a test fixture or assertion that hasn't already been updated needs to switch from `0|1|2|3` to `0|90|180|270`.

- [ ] **Step 2: Build and run all tests**

```bash
npm run build
npm test
```

Note any failing tests — they almost certainly point to remaining quarter-turn fixtures.

- [ ] **Step 3: Update each remaining fixture / assertion**

Apply the `× 90` conversion. Files likely to still need touching: `share-link.test.ts`, `reconstruct-groups.test.ts`, `share-section.test.ts`, `completion-overlay.test.ts`.

- [ ] **Step 4: Re-run all tests**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -p   # stage hunks individually to keep the commit focused on test fixture updates
git commit -m "$(cat <<'EOF'
test: update remaining rotation fixtures to degrees

Sweeps the test suite for any remaining quarter-turn (0..3)
literals on PieceGroup.rotation that weren't caught when the
producing code was migrated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Drop unused `normaliseQuarterTurns`

**Files:**
- Modify: `src/model/helpers.ts`

- [ ] **Step 1: Verify it's unused**

```bash
grep -rn "normaliseQuarterTurns" src --include='*.ts'
```

Expected: only the definition in `helpers.ts` remains. If any consumer is still importing it, that consumer was missed in an earlier task — update it before deleting.

- [ ] **Step 2: Remove the function and its export**

In `src/model/helpers.ts`, delete the `normaliseQuarterTurns` function entirely.

- [ ] **Step 3: Build and test**

```bash
npm run build
npm test
```

Expected: clean build, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/model/helpers.ts
git commit -m "$(cat <<'EOF'
refactor(helpers): drop normaliseQuarterTurns

Unused after the rotation-as-degrees refactor. normaliseDegrees
covers the same cases.

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

Open the running app in a browser and verify:

1. A fresh classic puzzle loads with `rotationMode === 'none'` (default), pieces at `rotation: 0`, no rotate buttons. Drag-and-drop merges work.
2. Open the New Game dialog → tick "Enable rotation" → start a fractal puzzle. Pieces start at random orientations from `{0, 90, 180, 270}`. Tap a piece → CCW/CW buttons appear → rotating snaps to those four orientations. Merging across rotations works as before (mate group + rotated drop).
3. Reload the page — the saved game restores with the same rotations. (Verifies the v8 → v9 migration plus the v9 round-trip.)
4. Generate a share link from a partially-merged quarter-turn puzzle. Open the link in a private window — the rotations restore correctly.

If any check fails, a regression slipped through; bisect by reverting commits one-by-one from this PR.

- [ ] **Step 3: Stop the dev server, no commit needed.**

---

## Task 15: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "refactor(rotation): represent group rotations as float degrees" --body "$(cat <<'EOF'
## Summary

Foundation refactor for the upcoming free-rotation feature. Changes the
internal representation of `PieceGroup.rotation` from a quarter-turn
integer (`0 | 1 | 2 | 3`) to float degrees (`number`, normalised to
`[0, 360)`). No user-visible change.

- `rotateGroup` now takes `deltaDegrees: number` instead of
  `direction: 'cw' | 'ccw'`; quarter-turn callers translate at the call
  site (`±90`).
- `rotatePoint` accepts arbitrary float degrees and uses `Math.cos` /
  `Math.sin` directly.
- Save format bumped to v9; v8 and earlier saves are migrated on load
  by multiplying stored rotations by 90.
- Share-link wire format is **unchanged** — encoder divides by 90,
  decoder multiplies by 90. Existing shared URLs continue to work.

## Test plan

- [ ] `npm test` — all green.
- [ ] Quarter-turn fractal puzzle: rotate via CCW/CW buttons, merge across rotations.
- [ ] Save + reload restores rotations.
- [ ] Open a share link generated before this PR — loads correctly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.
