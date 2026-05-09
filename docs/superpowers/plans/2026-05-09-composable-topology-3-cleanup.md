# Composable topology refactor 3: minPieceArea + cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NOTE:** Concrete code samples in this plan target the API shapes established in Plans 1 and 2 (`docs/superpowers/plans/2026-05-09-composable-topology-1-foundation.md` and `2026-05-09-composable-topology-2-multi-component.md`). After Plans 1 and 2 land, do a quick re-read of this plan and adjust signatures, file paths, and imports against what actually shipped before starting execution.

**Goal:** Add the `minPieceArea` config and the deterministic auto-grouping post-pass that replaces the existing tip-/lens-/small-face merging logic. Then delete the legacy modules (`mergeTabsIntoCuts`, `resolveExcessIntersections`, `mergeSmallFaces`, the orphan-pair logic in `findExcessPairs`) and their tests, leaving the Composable framework with a single, principled code path.

**Architecture:** Topology produces all faces "as they fall out," including tiny ones. A separate post-topology pass collects faces below `minPieceArea` and pre-glues each to its largest neighbour by creating a starting `PieceGroup`. The grouping is purely a delivery concern — topology is never rewritten. After this pass exists and is verified, all the older "fix-up" modules become dead code and are deleted.

**Tech Stack:** TypeScript, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-05-09-composable-topology-graph-design.md`

**Scope of this plan:** Steps 6–7 of the spec's "Order of work."

**Depends on:** Plans 1 and 2 must be complete and merged.

---

## File structure

**Create:**
- `src/puzzle/topology/auto-group.ts` — deterministic grouping of small faces with neighbours
- `src/puzzle/topology/auto-group.test.ts`

**Modify:**
- `src/puzzle/topology/generator.ts` — call `autoGroup` after `facesToPieceDefinitions`
- `src/puzzle/composable-generator.ts` — accept `minPieceArea` config field; pass through
- `src/sharing/share-link.ts` — already supports `mpa` field on `cf` (Plan 1); make sure it's propagated
- `src/game/init.ts` (or wherever `GameState.groups` is initialised) — accept the auto-group output as starting groups
- `src/model/types.ts` — `ComposableConfig` grows `minPieceArea` field

**Delete:**
- `src/puzzle/topology/tab-merge.ts` and its test
- `src/puzzle/topology/collision.ts`'s `findExcessPairs`, `resolveExcessIntersections`, `buildIntersectionCaps`, `detectExcessIntersections`, and the related test files (`excess-intersection.test.ts`, parts of `collision.test.ts`)
- `src/puzzle/topology/tip-pieces.test.ts` (the small-face merging is replaced by auto-grouping)
- The `mergeSmallFaces` function and its caller in `src/puzzle/topology/faces-to-pieces.ts`
- Diagnostics-only stages that referenced the deleted modules

The Plan 1 wrap of `tab-merge`'s `prepareTab`/`commitTab`/`computeTabPlacement` in `classic-tab-generator.ts` still uses those helpers — extract them out before deleting the rest of `tab-merge.ts`. See Task 7.

---

## Verification commands

- Type check: `npx tsc --noEmit`
- All tests: `npm test`
- Single file: `npx vitest run path/to/file.test.ts`

---

## Task 1: Add `minPieceArea` config field

**Files:**
- Modify: `src/puzzle/composable-generator.ts`
- Modify: `src/model/types.ts`
- Modify: `src/sharing/share-link.ts` (if needed; `mpa` was added in Plan 1)

- [ ] **Step 1: Extend `ComposableConfig`**

In `src/puzzle/composable-generator.ts`:

```ts
export interface ComposableConfig {
    baseCutGenerator?: string;
    baseCutConfig?: Record<string, unknown>;
    tabGenerator?: string;
    tabConfig?: Record<string, unknown>;
    /** Minimum area for a piece to stand alone; smaller pieces are auto-grouped with a neighbour. Default: empirically chosen. */
    minPieceArea?: number;
}
```

- [ ] **Step 2: Pick the default**

The default should clean up bezier-js sub-pixel-area numerical-noise faces without absorbing legitimate small pieces. Empirically test by running both repro seeds and the Venn case across a range of values; pick the largest value that doesn't absorb the Venn lens.

A reasonable starting guess: 4 px² (a 2×2 px square). Adjust upward only if numerical-noise faces survive.

```ts
const DEFAULT_MIN_PIECE_AREA = 4;
```

- [ ] **Step 3: Plumb through to `generateTopologyPuzzle`**

In `src/puzzle/composable-generator.ts`'s `generateComposablePuzzle`, pass `minPieceArea` (with the default) to `generateTopologyPuzzle`. In `topology/generator.ts`, accept it and use it in Task 3 below.

- [ ] **Step 4: Round-trip test for `mpa` in share-link**

Verify (and add a test if missing) that `SharePayload.cf.mpa` round-trips. The field was added in Plan 1; confirm it's still validated and serialised correctly.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/composable-generator.ts src/model/types.ts src/sharing/share-link.ts
git commit -m "feat(composable): minPieceArea config field with empirical default"
```

---

## Task 2: Auto-grouping function

**Files:**
- Create: `src/puzzle/topology/auto-group.ts`
- Create: `src/puzzle/topology/auto-group.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/auto-group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { autoGroupSmallPieces } from './auto-group.js';

describe('autoGroupSmallPieces', () => {
    it('returns a single group per piece when no piece is below threshold', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 100 }, { id: 2, area: 100 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(3);
        for (const g of groups) {
            expect(g.pieceIds).toHaveLength(1);
        }
    });

    it('groups a small piece with its largest neighbour', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 200 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(2);
        const grouped = groups.find(g => g.pieceIds.includes(1))!;
        expect(grouped.pieceIds).toContain(2);   // joined with the larger neighbour
        expect(grouped.pieceIds).not.toContain(0);
    });

    it('tie-breaks by lowest piece id when neighbours are equal', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 100 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        const grouped = groups.find(g => g.pieceIds.includes(1))!;
        expect(grouped.pieceIds).toContain(0);   // lowest id wins
        expect(grouped.pieceIds).not.toContain(2);
    });

    it('cascades: two adjacent tiny pieces collapse into one neighbour', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 5 }, { id: 3, area: 100 }],
            [[0, 1], [1, 2], [2, 3]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(2);
        // The two tiny ones end up with one of the big ones; either is OK
        // as long as the result is deterministic for fixed input.
    });
});

// Test helper — builds an AutoGroupContext shape directly.
function makeCtx(
    pieces: { id: number; area: number }[],
    edges: [number, number][],
) {
    const areas = new Map(pieces.map(p => [p.id, p.area]));
    const neighbours = new Map<number, Set<number>>();
    for (const p of pieces) neighbours.set(p.id, new Set());
    for (const [a, b] of edges) {
        neighbours.get(a)!.add(b);
        neighbours.get(b)!.add(a);
    }
    return {
        pieceIds: pieces.map(p => p.id),
        areas,
        neighbours,
    };
}
```

- [ ] **Step 2: Implement**

Create `src/puzzle/topology/auto-group.ts`:

```ts
/**
 * Deterministic auto-grouping of small pieces with neighbours.
 *
 * Iterates pieces in ascending area order. For each piece below
 * `minArea`, joins it to the largest non-already-grouped neighbour
 * (tie-break: lowest piece id). Cascades naturally — a small piece
 * absorbed into another small piece's group counts as that group's
 * area for subsequent iterations.
 *
 * Returns starting PieceGroups. Each group's pieceIds array is the
 * topological set; positioning + visual layout are handled by the
 * caller (the existing init.ts / new-game flow).
 */

import type { PieceGroup } from '../../model/types.js';

export interface AutoGroupContext {
    /** Ids of all pieces in the puzzle. */
    pieceIds: number[];
    /** For piece id p, the area of p's polygon in pixels². */
    areas: Map<number, number>;
    /** For piece id p, the ids of pieces sharing a non-border edge with p. */
    neighbours: Map<number, Set<number>>;
}

export function autoGroupSmallPieces(
    ctx: AutoGroupContext,
    minArea: number,
): PieceGroup[] {
    // Disjoint-set over piece ids. Initially each piece is its own root.
    const parent = new Map<number, number>();
    const groupArea = new Map<number, number>();
    for (const id of ctx.pieceIds) {
        parent.set(id, id);
        groupArea.set(id, ctx.areas.get(id)!);
    }

    function find(x: number): number {
        let r = x;
        while (parent.get(r)! !== r) r = parent.get(r)!;
        return r;
    }
    function union(a: number, b: number): void {
        const ra = find(a), rb = find(b);
        if (ra === rb) return;
        // Lower-id root wins, so behaviour is stable regardless of
        // input ordering.
        const winner = Math.min(ra, rb);
        const loser = ra === winner ? rb : ra;
        parent.set(loser, winner);
        groupArea.set(winner, groupArea.get(winner)! + groupArea.get(loser)!);
    }

    // Pieces in ascending area order, deterministic by id on ties.
    const sorted = [...ctx.pieceIds].sort((a, b) => {
        const da = ctx.areas.get(a)! - ctx.areas.get(b)!;
        return da !== 0 ? da : a - b;
    });

    for (const id of sorted) {
        const root = find(id);
        if (groupArea.get(root)! >= minArea) continue;

        // Pick the largest neighbour group; tie-break by lowest root id.
        let bestRoot = -1, bestArea = -1;
        for (const nid of ctx.neighbours.get(id) ?? []) {
            const nroot = find(nid);
            if (nroot === root) continue;
            const a = groupArea.get(nroot)!;
            if (a > bestArea || (a === bestArea && nroot < bestRoot)) {
                bestArea = a;
                bestRoot = nroot;
            }
        }
        if (bestRoot < 0) continue; // no neighbour — piece stays alone

        union(root, bestRoot);
    }

    // Collect groups by root.
    const byRoot = new Map<number, number[]>();
    for (const id of ctx.pieceIds) {
        const r = find(id);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r)!.push(id);
    }
    return [...byRoot.entries()].map(([rootId, pieceIds]) => ({
        id: rootId,
        pieceIds: pieceIds.sort((a, b) => a - b),
    } as PieceGroup));
}
```

- [ ] **Step 3: Verify**

```bash
npx vitest run src/puzzle/topology/auto-group.test.ts
```

Expected: all four tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/topology/auto-group.ts src/puzzle/topology/auto-group.test.ts
git commit -m "feat(topology): deterministic auto-group for small pieces"
```

---

## Task 3: Wire `autoGroupSmallPieces` into the generator pipeline

The generator pipeline currently produces a `Piece[]`. Auto-grouping must become a step that returns starting `PieceGroup[]` alongside the pieces. The natural seam is the boundary between `generateTopologyPuzzle` (returns `Piece[]`) and `init.ts` (creates `GameState`, including `groups`).

**Files:**
- Modify: `src/puzzle/composable-generator.ts` — return `{ pieces, autoGroups }` (or similar)
- Modify: `src/game/init.ts` — accept auto-groups as starting groups
- Modify: `src/puzzle/topology/generator.ts` — compute area + adjacency, call `autoGroupSmallPieces`

- [ ] **Step 1: Decide the return shape**

The cleanest option:

```ts
export interface ComposablePuzzle {
    pieces: Piece[];
    autoGroups: PieceGroup[];
}
```

`generateComposablePuzzle` returns this. Old call sites that just want `pieces` can destructure `{ pieces } = generateComposablePuzzle(...)`.

- [ ] **Step 2: Compute area and adjacency in the generator**

Inside `generateTopologyPuzzle`, after `facesToPieceDefinitions`, build:

```ts
const areas = new Map<number, number>();
const neighbours = new Map<number, Set<number>>();
for (const def of pieceDefs) {
    areas.set(def.id, computePolygonArea(def.edges));
    const ns = new Set<number>();
    for (const e of def.edges) {
        if (e.matePieceId >= 0) ns.add(e.matePieceId);
    }
    if (def.innerBoundaries) {
        for (const loop of def.innerBoundaries) {
            for (const e of loop) {
                if (e.matePieceId >= 0) ns.add(e.matePieceId);
            }
        }
    }
    neighbours.set(def.id, ns);
}
```

`computePolygonArea` is the shoelace formula on the edge endpoints (sample curves if highly curved).

- [ ] **Step 3: Call `autoGroupSmallPieces`**

```ts
const pieces = composePuzzle(pieceDefs, classicTabTemplate, random, { disableTabs: true });
const autoGroups = autoGroupSmallPieces(
    {
        pieceIds: pieceDefs.map(d => d.id),
        areas,
        neighbours,
    },
    minPieceArea,
);
return { pieces, autoGroups };
```

- [ ] **Step 4: Update `init.ts` to consume the auto-groups**

Replace the existing "every piece becomes its own group" initialisation with a path that uses `autoGroups` directly when the generator produces them. Existing styles (Classic, Fractal) keep their current behaviour because they don't return `autoGroups`.

- [ ] **Step 5: Verify**

```bash
npm test
```

Expected: all tests pass. Both repro seeds still produce 192 pieces (auto-grouping shouldn't affect them at minPieceArea = 4 because the bug-fix already eliminated the spurious tiny faces). Venn still produces 4 pieces. tip-pieces.test.ts may now produce additional groupings; if so, decide whether to update or delete (Task 6 deletes it).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/generator.ts \
        src/puzzle/composable-generator.ts \
        src/game/init.ts
git commit -m "feat(composable): wire auto-grouping into the generator pipeline"
```

---

## Task 4: Replace `mergeSmallFaces` with the new flow

Remove the call to `mergeSmallFaces` in `facesToPieceDefinitions`. The auto-group pass now handles the same concern (with a cleaner contract).

**Files:**
- Modify: `src/puzzle/topology/faces-to-pieces.ts`
- Delete: any tests targeting `mergeSmallFaces` directly

- [ ] **Step 1: Remove the call**

In `src/puzzle/topology/faces-to-pieces.ts`, delete the `mergeSmallFaces(dcel, expectedPieceCount)` call and the `expectedPieceCount` parameter (which was only used to gate `mergeSmallFaces`). Also delete the `mergeSmallFaces` function itself.

- [ ] **Step 2: Update the caller**

In `src/puzzle/topology/generator.ts`, drop the `expectedPieceCount` argument:

```ts
const pieceDefs = facesToPieceDefinitions(graph);
```

- [ ] **Step 3: Verify**

```bash
npm test
```

Expected: tests still pass. Some tip-piece-style tests may now fail because the rescue logic is gone; those tests are deleted in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/topology/faces-to-pieces.ts src/puzzle/topology/generator.ts
git commit -m "refactor(topology): remove mergeSmallFaces — auto-grouping replaces it"
```

---

## Task 5: Hoist tab helpers out of `tab-merge.ts`

The wrap in `classic-tab-generator.ts` (Plan 1) imports `prepareTab`, `commitTab`, and `computeTabPlacement` from `tab-merge.ts`. Before deleting `tab-merge.ts`, move those three functions into `classic-tab-generator.ts` (or a small helper file) so deletion is clean.

**Files:**
- Modify: `src/puzzle/topology/classic-tab-generator.ts` — inline the three helpers
- Modify: `src/puzzle/topology/tab-merge.ts` — keep ONLY the deprecated path now (deleted next task)

- [ ] **Step 1: Copy the three functions into `classic-tab-generator.ts`**

Move (copy + delete original) `prepareTab`, `commitTab`, `computeTabPlacement` from `tab-merge.ts` into a new private namespace at the bottom of `classic-tab-generator.ts`. Also move any helpers they depend on (`transformTabToEdge`, `joinCurves`, `lerp`).

After moving, the only thing left in `tab-merge.ts` is the deprecated `mergeTabsIntoCuts` and its private helpers — which Task 6 deletes.

- [ ] **Step 2: Verify**

```bash
npx vitest run src/puzzle/topology/classic-tab-generator.test.ts
npm test
```

Expected: tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/classic-tab-generator.ts src/puzzle/topology/tab-merge.ts
git commit -m "refactor(topology): inline tab helpers into classic-tab-generator"
```

---

## Task 6: Delete the legacy modules

After confirming no production call sites remain, delete the legacy modules and their tests in one commit.

**Files (delete):**
- `src/puzzle/topology/tab-merge.ts` (now empty / only deprecated `mergeTabsIntoCuts`)
- `src/puzzle/topology/tab-merge.test.ts`
- `src/puzzle/topology/excess-intersection.test.ts`
- `src/puzzle/topology/tip-pieces.test.ts`
- Parts of `src/puzzle/topology/collision.ts` — keep `CollisionDetector` / `ConflictResolver` interfaces only if Plan 1's `apply-tabs` still imports them; otherwise delete the whole file
- Parts of `src/puzzle/topology/collision.test.ts` matching the deleted exports

- [ ] **Step 1: Verify no production call sites**

```bash
grep -rn "mergeTabsIntoCuts\|resolveExcessIntersections\|findExcessPairs\|buildIntersectionCaps\|detectExcessIntersections\|mergeSmallFaces" --include="*.ts" src/ | grep -v "\.test\."
```

Expected: zero matches in non-test code. If any match, fix the call site before proceeding.

- [ ] **Step 2: Delete the files**

```bash
git rm src/puzzle/topology/tab-merge.ts \
       src/puzzle/topology/tab-merge.test.ts \
       src/puzzle/topology/excess-intersection.test.ts \
       src/puzzle/topology/tip-pieces.test.ts
```

For `collision.ts`: prune in place. Keep only the `CollisionDetector` / `ConflictResolver` shapes if `apply-tabs.ts` still uses them. Otherwise:

```bash
git rm src/puzzle/topology/collision.ts src/puzzle/topology/collision.test.ts
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm test
```

Expected: clean compile, all remaining tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(topology): remove legacy mergeTabsIntoCuts / excess-intersection / tip-piece modules"
```

---

## Task 7: Tidy up — diagnostics and dead imports

The `diagnostics` module currently emits stage messages from the deleted modules (`'splice'`, `'excess-detect'`, `'excess-pairs'`, `'merge'`). These messages stop being produced; nothing reads them, so no functional change. Optionally clean up the stage names list if there's a registry.

**Files:** anywhere a stage name from the deleted modules is hardcoded.

- [ ] **Step 1: Find references**

```bash
grep -rn "'splice'\|'excess-detect'\|'excess-pairs'\|'dcel-pre-merge'" --include="*.ts" src/
```

- [ ] **Step 2: Remove dead references**

For each match, decide: drop the line (if it's only logging) or update it (if it's a meaningful stage name in the new pipeline).

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 4: Commit**

```bash
git commit -am "chore(topology): drop diagnostics stages from deleted modules"
```

---

## Task 8: Update the in-app help text

Per `CLAUDE.md`, user-visible behaviour changes should update the info modal. Auto-grouping is technically user-visible (a player who notices that some pieces start pre-grouped should have an explanation), though it's subtle.

**Files:**
- Modify: `src/ui/info-modal.ts`

- [ ] **Step 1: Add a brief note**

In the "How to Play" or "Cut Styles" section of the info modal, add (or extend an existing bullet):

> Tiny slivers of pieces created by extreme cut shapes are automatically grouped with a neighbour, so you'll never see a piece smaller than a few square pixels.

- [ ] **Step 2: Verify**

```bash
npm test
```

Expected: info-modal tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/ui/info-modal.ts
git commit -m "docs(info-modal): document auto-grouping of tiny pieces"
```

---

## Done — Plan 3 acceptance check

- [ ] `npm test` — all green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `grep -rn "mergeTabsIntoCuts\|resolveExcessIntersections\|findExcessPairs\|mergeSmallFaces" src/` — zero matches.
- [ ] Plan 1's repro seeds (`124741785`, `3215341677`) still produce 192 pieces.
- [ ] Plan 2's Venn case still produces 4 pieces with one having an inner boundary.
- [ ] Visual smoke test: a Composable puzzle generated with extreme amplitudes (where the legacy code would have produced tip / lens artefacts) renders cleanly with no spurious tiny pieces; the player can drag pieces normally.

The Composable framework is now a single, principled code path: cuts → topology graph (one intersection pass) → tabs decorating edges (collision-rejected) → faces with multi-component support → pieces with optional inner boundaries → auto-grouped delivery. No more multi-stage drift bugs to chase, no more "fix-up" modules, and the framework is ready to host new `BaseCutGenerator` / `TabGenerator` plug-ins.
