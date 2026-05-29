# Traced-tab R4 Retry Ladder + Locality Culling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the ~20.7% flat-edge rate the traced tab generator produces at aggressive sine settings by retrying crossing-rejected tabs with cheap local variants, plus a bounding-box cull that speeds the crossing check for every tab and every generator.

**Architecture:** The `applyTabs` harness owns acceptance (endpoint + fold-back + crossing gates) and the graph. We add an optional `generateVariants` method to `TabGenerator`; when present, the harness commits the first variant that passes the gates. The traced generator yields an ordered ladder (base → shrink → pull-to-centre → shrink+centre → flip), all derived from a single set of PRNG draws so per-edge outer-PRNG consumption is unchanged. Independently, the crossing check skips edges whose bounding box can't overlap the candidate's.

**Tech Stack:** TypeScript, Vitest, bezier-js (via the existing `Curve` class). Cubic-Bézier paths are flat `Point[]` arrays (`BezierPath`).

**Design spec:** `docs/superpowers/specs/2026-05-29-traced-tab-r4-retry-design.md`

---

## File Structure

- `src/puzzle/topology/curve.ts` — add public `boundingBox()` + exported `BoundingBox` type (Task 1).
- `src/puzzle/topology/apply-tabs.ts` — bbox cull in `introducesNewCrossing`, per-edge box cache, variant-aware loop, `onCandidate` once per edge (Tasks 2, 5).
- `src/puzzle/composable/bezier-path.ts` — add `scaleBezierPath` (Task 3).
- `src/puzzle/topology/tab-generator-helpers.ts` — split `prepareTab` into `prepareTabFromPath`; add `spliceSmoothedFromPath`; `smoothedTabSplicer` delegates (Task 4).
- `src/puzzle/topology/plugin-types.ts` — add optional `generateVariants` to `TabGenerator` (Task 5).
- `src/puzzle/topology/traced-tab-generator.ts` — implement `generateVariants` (Task 6).
- `src/puzzle/topology/tab-rejection-measurement.test.ts` — gated before/after harness (Task 7).
- Unit tests live next to each source file.

Tasks 1–4 are independent and individually shippable. Task 5 depends on 1+2. Task 6 depends on 3+4+5.

---

## Task 1: `Curve.boundingBox()`

**Files:**
- Modify: `src/puzzle/topology/curve.ts`
- Test: `src/puzzle/topology/curve.test.ts` (add to existing file if present; else create)

- [ ] **Step 1: Write the failing test**

Add to `src/puzzle/topology/curve.test.ts` (create the file with this content if it does not exist):

```typescript
import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';

describe('Curve.boundingBox', () => {
    it('covers all control points (superset of the drawn curve)', () => {
        // A single cubic whose control points bulge above the chord.
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 10, y: -50 },
            { x: 90, y: -50 },
            { x: 100, y: 0 },
        ]);
        const box = c.boundingBox();
        expect(box.minX).toBeCloseTo(0);
        expect(box.maxX).toBeCloseTo(100);
        expect(box.minY).toBeCloseTo(-50);
        expect(box.maxY).toBeCloseTo(0);
    });

    it('unions across multiple segments', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 },
            { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 50, y: 30 },
        ]);
        const box = c.boundingBox();
        expect(box.minX).toBeCloseTo(0);
        expect(box.maxX).toBeCloseTo(50);
        expect(box.minY).toBeCloseTo(0);
        expect(box.maxY).toBeCloseTo(30);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/curve.test.ts -t boundingBox`
Expected: FAIL — `boundingBox is not a function`.

- [ ] **Step 3: Add the type and method**

In `src/puzzle/topology/curve.ts`, add an exported interface near the top types section (after `BezierSegment`, around line 46):

```typescript
/** Axis-aligned bounding box in screen coordinates. */
export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
```

Add this method to the `Curve` class, just after `sample(...)` (around line 430):

```typescript
    /**
     * Axis-aligned bounding box from the segments' control points.
     *
     * This is a conservative superset of the drawn curve (a cubic is
     * contained in its control polygon's hull), which is exactly what a
     * crossing pre-filter wants: boxes that don't overlap guarantee the
     * curves can't intersect, so the expensive intersect call is safe to
     * skip. Cheap — O(segments), no bezier-js objects.
     */
    boundingBox(): BoundingBox {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of this.segments) {
            for (const p of [s.p0, s.cp1, s.cp2, s.p3]) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }
        return { minX, minY, maxX, maxY };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/puzzle/topology/curve.test.ts -t boundingBox`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/curve.ts src/puzzle/topology/curve.test.ts
git commit -m "feat(curve): add boundingBox() for crossing pre-filter"
```

---

## Task 2: Bounding-box cull in the crossing check

**Files:**
- Modify: `src/puzzle/topology/apply-tabs.ts`
- Test: `src/puzzle/topology/apply-tabs.test.ts`

This is a pure optimization: it must not change any acceptance outcome. The existing apply-tabs tests are the regression net; we add one that exercises a far, non-overlapping edge.

- [ ] **Step 1: Write the failing test**

Add inside the `describe('applyTabs', …)` block in `src/puzzle/topology/apply-tabs.test.ts`:

```typescript
    it('accepts a small bump even when distant edges exist (cull does not drop real outcomes)', () => {
        // 3x3 grid: plenty of edges far from any given small bump. The
        // bump stays 1px off its own edge, so it crosses nothing and must
        // be accepted regardless of the bbox cull.
        const graph = buildDCEL({ curves: simpleGridCurves(3, 3) });
        const good: TabGenerator = {
            id: 'good',
            generate: (edge) => {
                const mid = edge.pointAt(0.5);
                const dx = edge.end.x - edge.start.x;
                const dy = edge.end.y - edge.start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const px = -dy / len, py = dx / len;
                return Curve.fromBezierPath([
                    edge.start, edge.start,
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    edge.end, edge.end,
                ]);
            },
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, good, makeSeededRandom(1));
        expect(internal.curve).not.toBe(before);
    });
```

- [ ] **Step 2: Run the full apply-tabs suite to confirm the current state is green**

Run: `npx vitest run src/puzzle/topology/apply-tabs.test.ts`
Expected: PASS (existing tests + the new one already passes, since the cull isn't in yet — this test guards against regressions while we add the cull).

- [ ] **Step 3: Add the cull and per-edge box cache**

In `src/puzzle/topology/apply-tabs.ts`:

Update the import of `Curve` to also bring in the box type:

```typescript
import { Curve } from './curve.js';
import type { BoundingBox } from './curve.js';
```

Add a margin constant next to the existing tolerances (around line 22):

```typescript
const CROSSING_BBOX_MARGIN = 0.5;        // px — bbox cull margin (>= intersect tolerance)
```

Add a small overlap helper near `pointDist` (bottom of file):

```typescript
function boxesOverlap(a: BoundingBox, b: BoundingBox, margin: number): boolean {
    return (
        a.minX - margin <= b.maxX &&
        a.maxX + margin >= b.minX &&
        a.minY - margin <= b.maxY &&
        a.maxY + margin >= b.minY
    );
}
```

Change `introducesNewCrossing`'s signature to take a box accessor, compute the candidate box once, and skip non-overlapping edges:

```typescript
function introducesNewCrossing(
    candidate: Curve,
    self: HalfEdge,
    graph: TopologyGraph,
    boxOf: (he: HalfEdge) => BoundingBox,
): boolean {
    const candStart = candidate.start;
    const candEnd = candidate.end;
    const candBox = candidate.boundingBox();

    const seen = new Set<number>();
    for (const he of graph.halfEdges) {
        if (seen.has(he.id) || seen.has(he.twin.id)) continue;
        seen.add(he.id);
        seen.add(he.twin.id);
        if (he.id === self.id || he.id === self.twin.id) continue;

        // Cull: boxes that can't overlap can't intersect.
        if (!boxesOverlap(candBox, boxOf(he), CROSSING_BBOX_MARGIN)) continue;

        const intersections = candidate.intersect(he.curve);
        for (const ix of intersections) {
            const dStart = pointDist(ix.point, candStart);
            const dEnd = pointDist(ix.point, candEnd);
            if (dStart < CROSSING_ENDPOINT_TOLERANCE) continue;
            if (dEnd < CROSSING_ENDPOINT_TOLERANCE) continue;
            return true;
        }
    }
    return false;
}
```

In `applyTabs`, build the cache and pass `boxOf`; invalidate on commit. Replace the per-edge loop body (lines ~72-94) with:

```typescript
    // Per-edge bounding-box cache for the crossing cull. Invalidated for
    // a half-edge pair when a tab is committed (its curve grows).
    const boxes = new Map<number, BoundingBox>();
    const boxOf = (he: HalfEdge): BoundingBox => {
        let b = boxes.get(he.id);
        if (!b) { b = he.curve.boundingBox(); boxes.set(he.id, b); }
        return b;
    };

    for (const he of sharedEdges) {
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
        };
        if (!policy(view)) continue;

        const candidate = generator.generate(he.curve, random, tabConfig);
        if (!candidate) {
            options.onCandidate?.(he, false);
            continue;
        }

        const accepted =
            endpointsMatch(candidate, he.curve) &&
            !foldsBackThroughSelf(candidate, he.curve) &&
            !introducesNewCrossing(candidate, he, graph, boxOf);
        options.onCandidate?.(he, accepted);
        if (!accepted) continue;

        he.curve = candidate;
        he.twin.curve = candidate.reverse();
        boxes.delete(he.id);
        boxes.delete(he.twin.id);
    }
```

- [ ] **Step 4: Run the suite to verify all green**

Run: `npx vitest run src/puzzle/topology/apply-tabs.test.ts`
Expected: PASS (all existing tests + the new far-edge test). Acceptance outcomes are unchanged; only skipped intersect calls differ.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/apply-tabs.ts src/puzzle/topology/apply-tabs.test.ts
git commit -m "perf(apply-tabs): bbox-cull the crossing check"
```

---

## Task 3: `scaleBezierPath` helper

**Files:**
- Modify: `src/puzzle/composable/bezier-path.ts`
- Test: `src/puzzle/composable/bezier-path.test.ts` (add to existing if present; else create)

- [ ] **Step 1: Write the failing test**

Add to `src/puzzle/composable/bezier-path.test.ts` (create with this content if absent):

```typescript
import { describe, it, expect } from 'vitest';
import { scaleBezierPath } from './bezier-path.js';

describe('scaleBezierPath', () => {
    it('scales x and y of every point independently', () => {
        const path = [
            { x: 0, y: 0 },
            { x: 2, y: 4 },
            { x: 6, y: 8 },
            { x: 10, y: 0 },
        ];
        const out = scaleBezierPath(path, 0.5, 0.25);
        expect(out).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 3, y: 2 },
            { x: 5, y: 0 },
        ]);
    });

    it('does not mutate the input', () => {
        const path = [{ x: 1, y: 1 }];
        scaleBezierPath(path, 2, 2);
        expect(path[0]).toEqual({ x: 1, y: 1 });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/composable/bezier-path.test.ts -t scaleBezierPath`
Expected: FAIL — `scaleBezierPath is not a function`.

- [ ] **Step 3: Implement**

Append to `src/puzzle/composable/bezier-path.ts`:

```typescript
/**
 * Scale a BezierPath's coordinates about the origin. Used to shrink a
 * tab (smaller footprint and depth) without regenerating its shape.
 * Tab placement positions everything relative to the path's own
 * midpoint, so scaling about the origin uniformly shrinks the tab.
 */
export function scaleBezierPath(path: BezierPath, sx: number, sy: number): BezierPath {
    return path.map(p => ({ x: p.x * sx, y: p.y * sy }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/puzzle/composable/bezier-path.test.ts -t scaleBezierPath`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/composable/bezier-path.ts src/puzzle/composable/bezier-path.test.ts
git commit -m "feat(bezier-path): add scaleBezierPath for tab shrinking"
```

---

## Task 4: Split path generation from the splice

**Files:**
- Modify: `src/puzzle/topology/tab-generator-helpers.ts`
- Test: `src/puzzle/topology/tab-generator-helpers.test.ts`

Goal: a deterministic, PRNG-free path-in splice so ladder variants reuse one generated path. `prepareTab` and `smoothedTabSplicer` keep identical behaviour (regression-guarded by existing tests).

- [ ] **Step 1: Write the failing test**

Add to `src/puzzle/topology/tab-generator-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import {
    prepareTab,
    prepareTabFromPath,
    spliceSmoothedFromPath,
} from './tab-generator-helpers.js';
import type { BezierPath } from '../composable/bezier-path.js';

// A fixed, symmetric tab path in template space (x roughly 0.4..0.6,
// bump up to y = -0.15). Deterministic — no PRNG.
const FIXED_PATH: BezierPath = [
    { x: 0.40, y: 0 },
    { x: 0.44, y: 0 }, { x: 0.46, y: -0.15 }, { x: 0.50, y: -0.15 },
    { x: 0.54, y: -0.15 }, { x: 0.56, y: 0 }, { x: 0.60, y: 0 },
];

describe('prepareTabFromPath / spliceSmoothedFromPath', () => {
    it('prepareTabFromPath consumes no PRNG and is deterministic', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const a = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        const b = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a!.tabCurve.segments).toEqual(b!.tabCurve.segments);
    });

    it('spliceSmoothedFromPath returns a curve with the edge endpoints', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const c = spliceSmoothedFromPath(edge, 0.5, true, FIXED_PATH);
        expect(c).not.toBeNull();
        expect(c!.start.x).toBeCloseTo(0);
        expect(c!.start.y).toBeCloseTo(0);
        expect(c!.end.x).toBeCloseTo(240);
        expect(c!.end.y).toBeCloseTo(0);
    });

    it('prepareTab still produces the same path-based result for one drawn path', () => {
        // prepareTab(template) must equal prepareTabFromPath(template.generate()).
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const template = { name: 'fixed', generate: (): BezierPath => FIXED_PATH };
        const viaTemplate = prepareTab(edge, 0.5, true, template, () => 0.5);
        const viaPath = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        expect(viaTemplate!.tabCurve.segments).toEqual(viaPath!.tabCurve.segments);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t prepareTabFromPath`
Expected: FAIL — `prepareTabFromPath is not a function` (and `spliceSmoothedFromPath` undefined).

- [ ] **Step 3: Refactor `prepareTab` and add the path-in helpers**

In `src/puzzle/topology/tab-generator-helpers.ts`, replace the current `prepareTab` (lines ~56-174) so it delegates to a new path-in function. Keep ALL the placement/splitting logic; only the first few lines (template.generate + mirror) move into the wrapper boundary:

```typescript
export function prepareTab(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): PreparedTab | null {
    return prepareTabFromPath(curve, tCenter, isTab, template.generate(random));
}

/**
 * Like {@link prepareTab} but takes an already-generated normalized tab
 * path instead of a template + PRNG. Pure and deterministic — consumes
 * no randomness — so the same path can be re-spliced (shrunk, moved,
 * sign-flipped) without advancing the PRNG. `tabPath` is in the tab
 * orientation (bump in -y / protruding); `isTab=false` mirrors it to a
 * blank here.
 */
export function prepareTabFromPath(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    tabPath: BezierPath,
): PreparedTab | null {
    let normalizedPath = tabPath;
    if (!isTab) {
        normalizedPath = mirrorBezierPathY(normalizedPath);
    }

    // The template's start/end x-values define how much of the edge
    // the tab occupies. These are fractions of edge length.
    const templateStartX = normalizedPath[0].x;
    const templateEndX = normalizedPath[normalizedPath.length - 1].x;

    // (… everything from the current prepareTab body, unchanged, from the
    //  `const templateMidX = …` line through the final
    //  `return { tabCurve, before, after };` …)
}
```

> Implementation note: the body from `const templateMidX = (templateStartX + templateEndX) / 2;` (current line ~79) down to the `return { tabCurve, before, after };` (current line ~173) is copied verbatim into `prepareTabFromPath`. Do not re-derive it.

Add a path-in smoothed splice and make `smoothedTabSplicer` delegate to it. Replace the current `smoothedTabSplicer` (lines ~328-335) with:

```typescript
/**
 * Smoothed splice from an already-generated path (no PRNG). Same output
 * as {@link smoothedTabSplicer} for a given path; used by generators that
 * re-splice one path into several placement/scale variants.
 */
export function spliceSmoothedFromPath(
    edge: Curve,
    tCenter: number,
    isTab: boolean,
    tabPath: BezierPath,
): Curve | null {
    const prepared = prepareTabFromPath(edge, tCenter, isTab, tabPath);
    if (!prepared) return null;
    return commitTab(alignTangentsAtSplice(prepared));
}

export const smoothedTabSplicer: TabSplicer = {
    id: 'tangent-smoothed',
    splice(edge, placement, template, random) {
        return spliceSmoothedFromPath(
            edge, placement.tCenter, placement.isTab, template.generate(random),
        );
    },
};
```

Ensure `BezierPath` is imported (it already is, around line 14: `import type { BezierPath } from '../composable/bezier-path.js';`).

- [ ] **Step 4: Run the helper + existing tab tests to verify behaviour preserved**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts src/puzzle/topology/traced-tab-generator.test.ts src/puzzle/topology/classic-tab-generator.test.ts`
Expected: PASS (new tests + all existing — `prepareTab` and `smoothedTabSplicer` behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/tab-generator-helpers.ts src/puzzle/topology/tab-generator-helpers.test.ts
git commit -m "refactor(tab-helpers): split path generation from splice"
```

---

## Task 5: Variant-aware `applyTabs` + interface

**Files:**
- Modify: `src/puzzle/topology/plugin-types.ts`
- Modify: `src/puzzle/topology/apply-tabs.ts`
- Test: `src/puzzle/topology/apply-tabs.test.ts`

Make the harness commit the first acceptable variant when a generator offers `generateVariants`. Tested with a fake generator (no traced dependency).

- [ ] **Step 1: Write the failing test**

Add inside `describe('applyTabs', …)`:

```typescript
    it('commits the first acceptable variant from generateVariants', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const bump = (edge: Curve, perp: number): Curve => {
            const mid = edge.pointAt(0.5);
            const dx = edge.end.x - edge.start.x;
            const dy = edge.end.y - edge.start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const px = -dy / len * perp, py = dx / len * perp;
            return Curve.fromBezierPath([
                edge.start, edge.start,
                { x: mid.x + px, y: mid.y + py },
                { x: mid.x + px, y: mid.y + py },
                { x: mid.x + px, y: mid.y + py },
                edge.end, edge.end,
            ]);
        };
        // First variant pokes 1000px (crosses neighbours -> rejected);
        // second is a 1px bump (accepted).
        const ladder: TabGenerator = {
            id: 'ladder',
            generate: (edge) => bump(edge, 1000),
            *generateVariants(edge) {
                yield bump(edge, 1000);
                yield bump(edge, 1);
            },
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, ladder, makeSeededRandom(1));
        expect(internal.curve).not.toBe(before);
    });

    it('leaves the edge flat when every variant is rejected', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const farOut = (edge: Curve): Curve => {
            const mid = edge.pointAt(0.5);
            return Curve.fromBezierPath([
                edge.start, edge.start,
                { x: mid.x, y: mid.y + 1000 },
                { x: mid.x, y: mid.y + 1000 },
                { x: mid.x, y: mid.y + 1000 },
                edge.end, edge.end,
            ]);
        };
        const allBad: TabGenerator = {
            id: 'all-bad',
            generate: (edge) => farOut(edge),
            *generateVariants(edge) { yield farOut(edge); yield farOut(edge); },
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, allBad, makeSeededRandom(1));
        expect(internal.curve).toBe(before);
    });

    it('fires onCandidate exactly once per eligible edge (variant path)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const gen: TabGenerator = {
            id: 'twovariants',
            generate: () => null,
            *generateVariants() { /* yields nothing -> flat */ },
        };
        let calls = 0;
        applyTabs(graph, gen, makeSeededRandom(1), {
            onCandidate: () => { calls++; },
        });
        expect(calls).toBe(4); // 2x2 grid has 4 internal shared edges
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/apply-tabs.test.ts -t generateVariants`
Expected: FAIL — variants ignored (first test fails: edge stays flat because the single `generate` returns the 1000px bump, rejected).

- [ ] **Step 3: Extend the interface**

In `src/puzzle/topology/plugin-types.ts`, add to the `TabGenerator` interface after `generate`:

```typescript
    /**
     * Optional: yield an ordered set of candidate curves (best first) for
     * one edge. When present, the framework commits the FIRST candidate
     * that passes its accept gates (endpoint match, no fold-back, no new
     * crossing) and ignores the rest; if none pass, the edge stays flat.
     *
     * All PRNG draws MUST happen before the first yield, so per-edge
     * randomness consumption is independent of how many candidates the
     * framework ends up trying. Generators without retry semantics omit
     * this and rely on {@link generate}.
     */
    generateVariants?(edge: Curve, random: () => number, config: unknown): Iterable<Curve>;
```

- [ ] **Step 4: Make the harness variant-aware**

In `src/puzzle/topology/apply-tabs.ts`, factor the accept gates into a helper and branch the loop. Add near the other private helpers:

```typescript
function isAcceptable(
    candidate: Curve,
    self: HalfEdge,
    graph: TopologyGraph,
    boxOf: (he: HalfEdge) => BoundingBox,
): boolean {
    return (
        endpointsMatch(candidate, self.curve) &&
        !foldsBackThroughSelf(candidate, self.curve) &&
        !introducesNewCrossing(candidate, self, graph, boxOf)
    );
}
```

Replace the per-edge body from Task 2 with the variant-aware version:

```typescript
    for (const he of sharedEdges) {
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
        };
        if (!policy(view)) continue;

        let chosen: Curve | null = null;
        if (generator.generateVariants) {
            for (const variant of generator.generateVariants(he.curve, random, tabConfig)) {
                if (!variant) continue;
                if (isAcceptable(variant, he, graph, boxOf)) { chosen = variant; break; }
            }
        } else {
            const candidate = generator.generate(he.curve, random, tabConfig);
            if (candidate && isAcceptable(candidate, he, graph, boxOf)) {
                chosen = candidate;
            }
        }

        options.onCandidate?.(he, chosen !== null);
        if (!chosen) continue;

        he.curve = chosen;
        he.twin.curve = chosen.reverse();
        boxes.delete(he.id);
        boxes.delete(he.twin.id);
    }
```

> Note: `onCandidate` now fires once per eligible edge with the final outcome (it previously also fired once per edge). This keeps it in lockstep with the traced-tab recorder, which records once per edge. Update the `onCandidate` doc comment in `ApplyTabsOptions` to say "fired once per eligible edge with whether a tab was committed."

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/puzzle/topology/apply-tabs.test.ts`
Expected: PASS (all existing + 3 new variant tests).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/plugin-types.ts src/puzzle/topology/apply-tabs.ts src/puzzle/topology/apply-tabs.test.ts
git commit -m "feat(apply-tabs): commit first acceptable tab variant"
```

---

## Task 6: Traced generator `generateVariants` ladder

**Files:**
- Modify: `src/puzzle/topology/traced-tab-generator.ts`
- Test: `src/puzzle/topology/traced-tab-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/puzzle/topology/traced-tab-generator.test.ts`:

```typescript
import { spliceSmoothedFromPath, computeTabPlacement, DEFAULT_TAB_PLACEMENT } from './tab-generator-helpers.js';

describe('tracedTabGenerator.generateVariants', () => {
    it('first variant equals generate() for the same seed', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const viaGenerate = tracedTabGenerator.generate(edge, createSeededRandom(7), {});
        const it = tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {})[Symbol.iterator]();
        const first = it.next().value as ReturnType<typeof tracedTabGenerator.generate>;
        expect(first).not.toBeNull();
        expect(viaGenerate).not.toBeNull();
        expect(first!.segments).toEqual(viaGenerate!.segments);
    });

    it('consumes exactly 3 outer PRNG calls regardless of variants pulled', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        let calls = 0;
        const counting = () => { calls++; return 0.5; };
        // Drain ALL variants.
        const all = [...tracedTabGenerator.generateVariants!(edge, counting, {})];
        expect(all.length).toBeGreaterThan(1);
        expect(calls).toBe(3);
    });

    it('yields nothing for a too-short edge (no PRNG drawn)', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        let calls = 0;
        const counting = () => { calls++; return 0.5; };
        const all = [...tracedTabGenerator.generateVariants!(edge, counting, {})];
        expect(all).toHaveLength(0);
        expect(calls).toBe(0);
    });

    it('every yielded variant keeps the edge endpoints', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        for (const v of tracedTabGenerator.generateVariants!(edge, createSeededRandom(3), {})) {
            expect(v.start.x).toBeCloseTo(0);
            expect(v.end.x).toBeCloseTo(240);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts -t generateVariants`
Expected: FAIL — `generateVariants` is undefined.

- [ ] **Step 3: Implement the ladder**

Rewrite `src/puzzle/topology/traced-tab-generator.ts`:

```typescript
/**
 * Traced tab generator: produces tab shapes from the photographed
 * library. Uses the tangent-smoothed splicer so the flowy
 * photographed curves join the parent edge with C1 continuity.
 *
 * `generate` places one tab (the legacy single-shot path).
 * `generateVariants` yields that same base tab first, then a short
 * "retry ladder" of cheap local variations (shrink, pull-to-centre,
 * sign flip). The framework commits the first that survives its
 * crossing checks — recovering edges that would otherwise be left flat
 * because the base tab crossed a neighbour. All PRNG draws happen
 * before the first yield, so per-edge consumption stays at exactly the
 * same 3 outer calls as `generate`.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import { scaleBezierPath } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    smoothedTabSplicer,
    spliceSmoothedFromPath,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

/** Shrink factor for the "smaller tab" rungs. */
const SHRINK = 0.8;
/** Fraction to pull the tab centre toward mid-edge (0.5) on the move rungs. */
const CENTRE_PULL = 0.5;

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;
        return smoothedTabSplicer.splice(edge, placement, tracedTabTemplate, random);
    },

    *generateVariants(edge: Curve, random: () => number, _config: unknown): Iterable<Curve> {
        // All PRNG draws up front: placement (2 calls) + template path (1).
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return;
        const basePath = tracedTabTemplate.generate(random);

        const { tCenter, isTab } = placement;
        const tCentre = tCenter + (0.5 - tCenter) * CENTRE_PULL;
        const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);

        // Best-first ladder: [tCenter, isTab, path].
        const rungs: ReadonlyArray<readonly [number, boolean, typeof basePath]> = [
            [tCenter, isTab, basePath],   // base (== generate())
            [tCenter, isTab, shrunk],     // shrink
            [tCentre, isTab, basePath],   // pull to centre
            [tCentre, isTab, shrunk],     // shrink + centre
            [tCenter, !isTab, basePath],  // flip sign
        ];

        for (const [tc, tab, path] of rungs) {
            const candidate = spliceSmoothedFromPath(edge, tc, tab, path);
            if (candidate) yield candidate;
        }
    },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts`
Expected: PASS (existing `generate` tests + 4 new `generateVariants` tests).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/traced-tab-generator.ts src/puzzle/topology/traced-tab-generator.test.ts
git commit -m "feat(traced-tab): retry ladder via generateVariants"
```

---

## Task 7: Gated before/after measurement harness

**Files:**
- Create: `src/puzzle/topology/tab-rejection-measurement.test.ts`

This test is skipped unless `MEASURE_TABS=1`, so it never runs in normal CI. It measures the rejection rate at the user's real settings via the public `onCandidate` hook (no internals needed).

- [ ] **Step 1: Create the harness**

```typescript
/**
 * Gated measurement: traced-tab rejection rate at the user's real
 * Composable settings. Skipped unless MEASURE_TABS=1.
 *
 *   MEASURE_TABS=1 npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts
 *
 * Baseline (before the retry ladder): ~20.7% of internal edges flat,
 * all R4 crossings. Expect a substantial drop after the ladder lands.
 */

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from '../seeded-random.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { tracedTabGenerator } from './traced-tab-generator.js';

const RUN = process.env.MEASURE_TABS === '1';

describe('traced-tab rejection measurement', () => {
    (RUN ? it : it.skip)('reports the flat-edge rate at the user settings', { timeout: 300_000 }, () => {
        const cfg = { cols: 16, rows: 12, ha: 0.5, hf: 8, va: 0.5, vf: 6 };
        const frame = { width: 1600, height: 1200 };
        const SEEDS = 15;

        let total = 0;
        let accepted = 0;
        for (let s = 0; s < SEEDS; s++) {
            const random = createSeededRandom(s);
            const curves = sineCutGenerator.generate(frame, random, cfg);
            const graph = buildDCEL({ curves });
            applyTabs(graph, tracedTabGenerator, random, {
                onCandidate: (_he, ok) => { total++; if (ok) accepted++; },
            });
        }
        const rejectPct = (100 * (total - accepted)) / total;
        // eslint-disable-next-line no-console
        console.log(`eligible=${total} accepted=${accepted} flat=${(total - accepted)} reject=${rejectPct.toFixed(1)}%`);
        // Sanity only — the real signal is the printed number vs the 20.7% baseline.
        expect(total).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it (gated)**

Run: `MEASURE_TABS=1 npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts`
Expected: PASS; the console line shows a `reject=…%` substantially below the 20.7% baseline (the ladder should recover most R4 edges). Record the number in the commit body.

- [ ] **Step 3: Confirm it is skipped by default**

Run: `npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts`
Expected: the test is reported as skipped (1 skipped).

- [ ] **Step 4: Commit**

```bash
git add src/puzzle/topology/tab-rejection-measurement.test.ts
git commit -m "test(traced-tab): gated rejection-rate measurement harness"
```

---

## Task 8: Full verification + visual check

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: all tests pass (the gated measurement is skipped).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint src/puzzle/topology/curve.ts src/puzzle/topology/apply-tabs.ts src/puzzle/topology/tab-generator-helpers.ts src/puzzle/topology/traced-tab-generator.ts src/puzzle/composable/bezier-path.ts`
Expected: no errors (the only `no-console` is the eslint-disabled line in the gated harness).

- [ ] **Step 4: Confirm no help-text update is needed**

Run: `grep -in "traced\|composable" src/ui/info-modal.ts`
Expected: no player-facing mention of traced/Composable tabs (it is dev-deploy only). If there IS a mention, update the relevant section per `CLAUDE.md`'s help-text rule. Otherwise, no change.

- [ ] **Step 5: Visual check on dev-deploy**

Launch the app, start a Composable puzzle with the user's settings (16×12, ha=va=0.5, hf=8, vf=6, traced tabs), and confirm:
- noticeably fewer flat internal edges than before;
- no obvious "all-small-tab" or "all-centred-tab" band on wavy-corner edges;
- no obvious tab/blank parity artefacts.

Use the `run` skill or `__newComposableGame({ cols:16, rows:12, baseCutConfig:{ cols:16, rows:12, ha:0.5, hf:8, va:0.5, vf:6 }, tabGenerator:'traced' })` dev-console helper.

- [ ] **Step 6: (Optional) tune the ladder**

If the visual or measured result wants adjustment, the only knobs are `SHRINK`, `CENTRE_PULL`, and the `rungs` order/array in `traced-tab-generator.ts`. Re-run Task 7's harness after any change. Commit separately, e.g. `tune(traced-tab): adjust retry ladder factors`.

---

## Self-review notes (author)

- **Spec coverage:** ladder (Task 6) ✓; variant interface (Task 5) ✓; PRNG-safe path split (Task 4) ✓; locality culling, generator-agnostic & first-attempt (Task 2) ✓; validation harness + visual (Tasks 7–8) ✓; out-of-scope items left untouched ✓.
- **PRNG contract:** every traced draw is before the first `yield`; first variant byte-equals `generate()` (Task 6 test) — puzzles whose first attempt already succeeded are unchanged.
- **Type consistency:** `BoundingBox` (Task 1) is the return of `boundingBox()` and the value type of the `boxes` cache and `boxOf` (Task 2/5); `introducesNewCrossing(candidate, self, graph, boxOf)` signature is consistent across Tasks 2 and 5; `prepareTabFromPath` / `spliceSmoothedFromPath` signatures match between Task 4 (definition) and Task 6 (use); `scaleBezierPath(path, sx, sy)` matches between Task 3 and Task 6.
