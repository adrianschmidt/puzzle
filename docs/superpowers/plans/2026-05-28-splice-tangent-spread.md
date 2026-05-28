# Splice Tangent Spread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spread the C1 splice alignment in `smoothedTabSplicer` over multiple template anchors when the parent edge is highly curved, by dropping the near-splice anchors that fight the parent's curvature and bridging the gap with a single cubic — removing the sharp corner the current single-segment fix leaves on sine base-cuts.

**Architecture:** All work is in `alignTangentsAtSplice` (used only by `smoothedTabSplicer` → traced generator) and operates on the already-transformed world-space tab. At each splice end we measure the angle correction θ, map it to a smoothing distance `d` (fraction of the tab's splice-to-splice chord), drop the interior anchors within `d`, and replace that span with one cubic that leaves the splice along the parent's tangent and arrives at the first surviving anchor along that anchor's natural tangent. Small angles fall back to today's outermost-cp rotation. No `random()` calls are touched, so the share-link PRNG contract is intact.

**Tech Stack:** TypeScript, Vitest. Pure cubic-Bézier geometry on the existing `Curve` / `BezierSegment` types in `src/puzzle/topology/`.

**Spec:** `docs/superpowers/specs/2026-05-28-splice-tangent-spread-design.md`

---

## Context the implementer needs

- `smoothedTabSplicer` (in `src/puzzle/topology/tab-generator-helpers.ts`)
  calls `alignTangentsAtSplice(prepared)` and then `commitTab`. `prepared`
  is a `PreparedTab` with `{ tabCurve, before, after }`, all `Curve`s, all
  in world coordinates. The tab's first anchor (`tabCurve.segments[0].p0`)
  equals `before.end`; its last anchor equals `after.start` — these are the
  two splice points and are exact (snapped in `prepareTab`).
- A `Curve` is a chain of `BezierSegment`s: `{ p0, cp1, cp2, p3 }`. A tab
  with `m` segments has `m + 1` anchors: `segments[0].p0`, then each
  `segments[i].p3`.
- The parent tangents at the two splices are produced by the existing
  `tangentAtEnd(before)` (direction the parent travels leaving the left
  splice) and `tangentAtStart(after)` (direction entering the right
  splice). Reuse them unchanged.
- `standardTabSplicer` and the classic generator do NOT call this function;
  they are unaffected. The existing `smoothedTabSplicer` tests use
  `classicTabTemplate` on a curved parent purely as a vehicle.
- The current `alignTangentsAtSplice` (lines ~341-381) rotates only
  `segments[0].cp1` and `segments[last].cp2` onto the parent tangents,
  preserving their distances. This becomes the *fallback* path.

Run tests with: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts`
(The repo's `npm test` runs the whole suite; scope to the file while iterating.)

---

## File Structure

- **Modify:** `src/puzzle/topology/tab-generator-helpers.ts`
  - Add exported `spliceSmoothingChordFraction(thetaRadians)`.
  - Add private helpers: `angleBetweenUnit`, `unitVec`, `farthestAnchorIndex`,
    `computeSpliceZones`, `buildLeftBridge`, `buildRightBridge`,
    `rotateFirstCp`, `rotateLastCp`, `alignOutermostOnly`.
  - Replace the body of `alignTangentsAtSplice`.
  - `tangentAtEnd` / `tangentAtStart` stay as-is.
- **Modify (tests):** `src/puzzle/topology/tab-generator-helpers.test.ts`
  - Add a `describe('spliceSmoothingChordFraction')` block.
  - Add a synthetic multi-anchor template helper + 3 integration tests in a
    new `describe` block.

---

## Task 1: Angle → smoothing-distance ramp

**Files:**
- Modify: `src/puzzle/topology/tab-generator-helpers.ts`
- Test: `src/puzzle/topology/tab-generator-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Add this block at the end of `tab-generator-helpers.test.ts`, and add
`spliceSmoothingChordFraction` to the existing import from
`./tab-generator-helpers.js`:

```ts
import { spliceSmoothingChordFraction } from './tab-generator-helpers.js';

describe('spliceSmoothingChordFraction', () => {
    const deg = (d: number) => (d * Math.PI) / 180;

    it('is zero at and below the 10° threshold', () => {
        expect(spliceSmoothingChordFraction(deg(0))).toBe(0);
        expect(spliceSmoothingChordFraction(deg(10))).toBe(0);
    });

    it('hits the table breakpoints', () => {
        expect(spliceSmoothingChordFraction(deg(30))).toBeCloseTo(0.05, 6);
        expect(spliceSmoothingChordFraction(deg(60))).toBeCloseTo(0.15, 6);
        expect(spliceSmoothingChordFraction(deg(90))).toBeCloseTo(0.30, 6);
    });

    it('interpolates linearly between breakpoints', () => {
        // Midway between 30° (0.05) and 60° (0.15) is 45° → 0.10.
        expect(spliceSmoothingChordFraction(deg(45))).toBeCloseTo(0.10, 6);
        // Midway between 10° (0) and 30° (0.05) is 20° → 0.025.
        expect(spliceSmoothingChordFraction(deg(20))).toBeCloseTo(0.025, 6);
    });

    it('clamps flat above 90°', () => {
        expect(spliceSmoothingChordFraction(deg(120))).toBe(0.30);
        expect(spliceSmoothingChordFraction(deg(180))).toBe(0.30);
    });

    it('is monotonically non-decreasing across the range', () => {
        let prev = -1;
        for (let d = 0; d <= 180; d += 5) {
            const v = spliceSmoothingChordFraction(deg(d));
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t spliceSmoothingChordFraction`
Expected: FAIL — `spliceSmoothingChordFraction` is not exported (import error / undefined).

- [ ] **Step 3: Implement the ramp**

In `tab-generator-helpers.ts`, add this in the "Splicers" section (just
above `alignTangentsAtSplice`):

```ts
/**
 * Smoothing distance for a splice angle correction, expressed as a
 * fraction of the tab's splice-to-splice chord. Monotonic
 * piecewise-linear ramp: 0 at/below 10°, rising to 0.30 at 90° and
 * clamped flat beyond. A bigger angle correction is spread over a
 * longer arc (more anchors fall in the smoothing zone).
 *
 * Breakpoints are the issue's empirical starting values (issue #371);
 * retune here after inspecting the seed-1086655870 reference puzzle.
 */
const SPLICE_SMOOTHING_RAMP: ReadonlyArray<readonly [number, number]> = [
    [10, 0.0],
    [30, 0.05],
    [60, 0.15],
    [90, 0.30],
];

export function spliceSmoothingChordFraction(thetaRadians: number): number {
    const deg = (thetaRadians * 180) / Math.PI;
    const ramp = SPLICE_SMOOTHING_RAMP;
    if (deg <= ramp[0][0]) return 0;
    const last = ramp[ramp.length - 1];
    if (deg >= last[0]) return last[1];
    for (let i = 1; i < ramp.length; i++) {
        const [d0, v0] = ramp[i - 1];
        const [d1, v1] = ramp[i];
        if (deg <= d1) {
            const t = (deg - d0) / (d1 - d0);
            return v0 + (v1 - v0) * t;
        }
    }
    return last[1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t spliceSmoothingChordFraction`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/tab-generator-helpers.ts src/puzzle/topology/tab-generator-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(splicer): add angle-to-smoothing-distance ramp

Maps a splice tangent-correction angle to a smoothing distance (chord
fraction) for spreading C1 alignment over multiple anchors. Issue #371.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Anchor-removal + single-cubic bridge in `alignTangentsAtSplice`

**Files:**
- Modify: `src/puzzle/topology/tab-generator-helpers.ts`
- Test: `src/puzzle/topology/tab-generator-helpers.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add this block at the end of `tab-generator-helpers.test.ts`. It adds a
synthetic multi-anchor template (so anchor-drop counts don't depend on the
photographed traces) and a strongly curved parent. Reuses the existing
`unitTangentLeaving` / `unitTangentEntering` helpers already in the file.
Add `TabTemplate`, `Point`, and `BezierPath` types to imports as shown.

```ts
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { Point } from '../../model/types.js';

/**
 * A template with closely-spaced neck anchors and a head bump, so a
 * curved parent's smoothing zone drops a predictable number of anchors.
 * Control points sit at 1/3 and 2/3 between consecutive anchors
 * (chord-aligned tangents). 9 anchors → 8 segments; apex at index 4.
 */
const NECK_HEAVY_ANCHORS: Point[] = [
    { x: 0.30, y: 0.00 },
    { x: 0.32, y: 0.03 },
    { x: 0.34, y: 0.06 },
    { x: 0.40, y: 0.13 },
    { x: 0.50, y: 0.17 }, // apex (head)
    { x: 0.60, y: 0.13 },
    { x: 0.66, y: 0.06 },
    { x: 0.68, y: 0.03 },
    { x: 0.70, y: 0.00 },
];

function makeTemplate(anchors: Point[]): TabTemplate {
    const path: Point[] = [anchors[0]];
    for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        path.push({ x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 });
        path.push({ x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 });
        path.push({ x: b.x, y: b.y });
    }
    return { name: 'synthetic', generate: () => path };
}

/** Tab anchor (segment boundary) farthest from the tab's splice chord. */
function farthestTabAnchor(result: Curve): Point {
    const segs = result.segments;
    const N = segs.length - 2;            // tab occupies segs[1..N]
    const start = segs[1].p0;
    const end = segs[N].p3;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const anchors: Point[] = [segs[1].p0, ...segs.slice(1, N + 1).map(s => s.p3)];
    let best = anchors[0];
    let bestDist = -1;
    for (const a of anchors) {
        const d = Math.abs((a.x - start.x) * nx + (a.y - start.y) * ny);
        if (d > bestDist) { bestDist = d; best = a; }
    }
    return best;
}

describe('smoothedTabSplicer anchor-removal', () => {
    // A hard parabola-like parent: tangent at the splices is far from the
    // splice chord, forcing a large angle correction θ at each splice.
    function hardCurvedParent(): Curve {
        return new Curve([{
            p0: { x: 0, y: 0 },
            cp1: { x: 0, y: 300 },
            cp2: { x: 240, y: 300 },
            p3: { x: 240, y: 0 },
        }]);
    }

    it('drops near-splice anchors and stays C1 on a strongly curved parent', () => {
        const tmpl = makeTemplate(NECK_HEAVY_ANCHORS);
        const edge = hardCurvedParent();
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // At least one anchor was dropped → fewer segments overall.
        expect(smoothed.segments.length).toBeLessThan(standard.segments.length);

        // Splice is still C1 at both ends.
        const N = smoothed.segments.length - 2;
        const beforeOut = unitTangentLeaving(smoothed.segments[0]);
        const tabIn = unitTangentEntering(smoothed.segments[1]);
        expect(tabIn.x).toBeCloseTo(beforeOut.x, 6);
        expect(tabIn.y).toBeCloseTo(beforeOut.y, 6);

        const tabOut = unitTangentLeaving(smoothed.segments[N]);
        const afterIn = unitTangentEntering(smoothed.segments[N + 1]);
        expect(afterIn.x).toBeCloseTo(tabOut.x, 6);
        expect(afterIn.y).toBeCloseTo(tabOut.y, 6);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t "anchor-removal"`
Expected: FAIL on `expect(smoothed.segments.length).toBeLessThan(standard.segments.length)` — the current code never removes anchors, so the counts are equal.

- [ ] **Step 3: Replace `alignTangentsAtSplice` and add helpers**

In `tab-generator-helpers.ts`, replace the entire current
`alignTangentsAtSplice` function (the JSDoc block + function body, lines
~337-381 — everything from the `/** Adjust the tabCurve's outermost ... */`
comment down to and including its closing brace) with the following. Leave
`tangentAtEnd` and `tangentAtStart` untouched below it.

```ts
/**
 * Bring the tab to a C1 (smooth-direction) join with the parent at both
 * splices. On a near-straight parent the angle correction is tiny and we
 * just rotate the outermost control point (the original behaviour). On a
 * highly-curved parent the correction is large, so we spread it: drop the
 * template anchors within a splice-angle-scaled zone of each splice and
 * bridge the gap with one cubic that leaves the splice along the parent's
 * tangent. This avoids the sharp corner the single-segment rotation leaves
 * on curved parents (issue #371, Variant B).
 *
 * Pure post-processing on the already-spliced tab — no PRNG involvement,
 * so the share-link contract is unaffected.
 */
function alignTangentsAtSplice(prepared: PreparedTab): PreparedTab {
    const { before, after } = prepared;
    const segs = prepared.tabCurve.segments.slice();
    if (segs.length === 0) return prepared;

    const beforeTangent = tangentAtEnd(before);
    const afterTangent = tangentAtStart(after);

    const { firstSurvL, lastSurvR } = computeSpliceZones(
        segs, beforeTangent, afterTangent,
    );

    const leftRemoves = firstSurvL > 1;
    const rightRemoves = lastSurvR < segs.length - 1;

    if (!leftRemoves && !rightRemoves) {
        // Small angles at both ends: preserve the original behaviour of
        // rotating just the outermost cp at each splice.
        return alignOutermostOnly(prepared, segs, beforeTangent, afterTangent);
    }

    const m = segs.length;
    const result: BezierSegment[] = [];

    // Left end.
    if (leftRemoves) {
        result.push(buildLeftBridge(segs, firstSurvL, beforeTangent));
    } else {
        result.push(rotateFirstCp(segs[0], beforeTangent));
    }

    // Surviving original middle segments.
    const midStart = leftRemoves ? firstSurvL : 1;
    const midEnd = rightRemoves ? lastSurvR - 1 : m - 2;
    for (let i = midStart; i <= midEnd; i++) {
        result.push(segs[i]);
    }

    // Right end.
    if (rightRemoves) {
        result.push(buildRightBridge(segs, lastSurvR, afterTangent));
    } else {
        result.push(rotateLastCp(segs[m - 1], afterTangent));
    }

    return { before, tabCurve: new Curve(result), after };
}

/** Angle in radians between two unit vectors. */
function angleBetweenUnit(a: Point, b: Point): number {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
    return Math.acos(dot);
}

/** Unit vector (dx, dy), falling back to (fbx, fby) when ~zero length. */
function unitVec(dx: number, dy: number, fbx: number, fby: number): Point {
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? { x: fbx, y: fby } : { x: dx / len, y: dy / len };
}

/**
 * Index of the interior anchor farthest (perpendicular distance) from the
 * chord between the first and last anchors — i.e. the tab's head. Used to
 * stop the smoothing zones from ever consuming the head.
 */
function farthestAnchorIndex(anchors: Point[]): number {
    const a = anchors[0];
    const b = anchors[anchors.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let best = 1;
    let bestDist = -1;
    for (let i = 1; i < anchors.length - 1; i++) {
        const d = Math.abs((anchors[i].x - a.x) * nx + (anchors[i].y - a.y) * ny);
        if (d > bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/**
 * Decide which anchors survive at each end. Returns the index of the first
 * surviving anchor from the left (`firstSurvL`, ≥ 1) and the last surviving
 * anchor from the right (`lastSurvR`, ≤ m-1). `firstSurvL === 1` /
 * `lastSurvR === m-1` mean "no removal at that end".
 *
 * Guards: the head anchor never falls inside a zone, and at least one
 * original segment survives between the two bridges (so each bridge's far
 * tangent comes from real template geometry). When neither can be honoured
 * (tab too short), returns the no-removal sentinel.
 */
function computeSpliceZones(
    segs: readonly BezierSegment[],
    beforeTangent: Point,
    afterTangent: Point,
): { firstSurvL: number; lastSurvR: number } {
    const m = segs.length;
    const noRemoval = { firstSurvL: 1, lastSurvR: m - 1 };
    if (m < 3) return noRemoval;

    const anchors: Point[] = [segs[0].p0, ...segs.map(s => s.p3)];
    const chord = Math.hypot(
        anchors[m].x - anchors[0].x,
        anchors[m].y - anchors[0].y,
    );
    if (chord < 1e-9) return noRemoval;

    const headIndex = farthestAnchorIndex(anchors);

    // Left zone: walk inward from anchor 0 while within dL.
    const leftNatural = unitVec(
        segs[0].cp1.x - segs[0].p0.x, segs[0].cp1.y - segs[0].p0.y,
        segs[0].p3.x - segs[0].p0.x, segs[0].p3.y - segs[0].p0.y,
    );
    const dL = spliceSmoothingChordFraction(
        angleBetweenUnit(beforeTangent, leftNatural),
    ) * chord;
    let firstSurvL = 1;
    let cum = 0;
    for (let i = 1; i < m; i++) {
        cum += Math.hypot(
            anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y,
        );
        if (cum < dL) firstSurvL = i + 1; else break;
    }
    firstSurvL = Math.min(firstSurvL, headIndex);

    // Right zone: walk inward from anchor m while within dR.
    const rightNatural = unitVec(
        segs[m - 1].p3.x - segs[m - 1].cp2.x, segs[m - 1].p3.y - segs[m - 1].cp2.y,
        segs[m - 1].p3.x - segs[m - 1].p0.x, segs[m - 1].p3.y - segs[m - 1].p0.y,
    );
    const dR = spliceSmoothingChordFraction(
        angleBetweenUnit(afterTangent, rightNatural),
    ) * chord;
    let lastSurvR = m - 1;
    cum = 0;
    for (let i = m - 1; i >= 1; i--) {
        cum += Math.hypot(
            anchors[i + 1].x - anchors[i].x, anchors[i + 1].y - anchors[i].y,
        );
        if (cum < dR) lastSurvR = i - 1; else break;
    }
    lastSurvR = Math.max(lastSurvR, headIndex);

    // Need ≥ 1 surviving original segment strictly between the bridges.
    if (lastSurvR < firstSurvL + 1) return noRemoval;

    return { firstSurvL, lastSurvR };
}

/**
 * One cubic from the left splice (anchor 0) to the first surviving anchor.
 * Leaves the splice along the parent tangent; arrives along the surviving
 * segment's forward tangent (C1 with surviving geometry). Control magnitudes
 * = chord/3 (cubic-Hermite default), matching smooth-clusters.py.
 */
function buildLeftBridge(
    segs: readonly BezierSegment[],
    firstSurvL: number,
    parentTangent: Point,
): BezierSegment {
    const p0 = segs[0].p0;
    const surviving = segs[firstSurvL];
    const p3 = surviving.p0; // === anchors[firstSurvL]
    const fwd = unitVec(
        surviving.cp1.x - surviving.p0.x, surviving.cp1.y - surviving.p0.y,
        surviving.p3.x - surviving.p0.x, surviving.p3.y - surviving.p0.y,
    );
    const mag = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
    return {
        p0,
        cp1: { x: p0.x + parentTangent.x * mag, y: p0.y + parentTangent.y * mag },
        cp2: { x: p3.x - fwd.x * mag, y: p3.y - fwd.y * mag },
        p3,
    };
}

/**
 * One cubic from the last surviving anchor to the right splice (anchor m).
 * Leaves the surviving anchor along the preceding segment's tangent (C1);
 * arrives at the splice along the parent tangent.
 */
function buildRightBridge(
    segs: readonly BezierSegment[],
    lastSurvR: number,
    parentTangent: Point,
): BezierSegment {
    const m = segs.length;
    const p0 = segs[lastSurvR].p0; // === anchors[lastSurvR]
    const p3 = segs[m - 1].p3;     // === anchors[m]
    const prev = segs[lastSurvR - 1];
    const bwd = unitVec(
        prev.p3.x - prev.cp2.x, prev.p3.y - prev.cp2.y,
        prev.p3.x - prev.p0.x, prev.p3.y - prev.p0.y,
    );
    const mag = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
    return {
        p0,
        cp1: { x: p0.x + bwd.x * mag, y: p0.y + bwd.y * mag },
        cp2: { x: p3.x - parentTangent.x * mag, y: p3.y - parentTangent.y * mag },
        p3,
    };
}

/** Rotate a segment's cp1 onto `tangent`, preserving |p0 → cp1|. */
function rotateFirstCp(seg: BezierSegment, tangent: Point): BezierSegment {
    const d = Math.hypot(seg.cp1.x - seg.p0.x, seg.cp1.y - seg.p0.y);
    if (d <= 1e-9) return seg;
    return {
        ...seg,
        cp1: { x: seg.p0.x + tangent.x * d, y: seg.p0.y + tangent.y * d },
    };
}

/** Rotate a segment's cp2 so (p3 − cp2) ∥ `tangent`, preserving |p3 → cp2|. */
function rotateLastCp(seg: BezierSegment, tangent: Point): BezierSegment {
    const d = Math.hypot(seg.p3.x - seg.cp2.x, seg.p3.y - seg.cp2.y);
    if (d <= 1e-9) return seg;
    return {
        ...seg,
        cp2: { x: seg.p3.x - tangent.x * d, y: seg.p3.y - tangent.y * d },
    };
}

/**
 * Original behaviour: rotate only the tab's outermost control points onto
 * the parent tangents. Used when no anchors fall in either smoothing zone.
 */
function alignOutermostOnly(
    prepared: PreparedTab,
    segs: BezierSegment[],
    beforeTangent: Point,
    afterTangent: Point,
): PreparedTab {
    const out = segs.slice();
    out[0] = rotateFirstCp(out[0], beforeTangent);
    const lastIdx = out.length - 1;
    out[lastIdx] = rotateLastCp(out[lastIdx], afterTangent);
    return {
        before: prepared.before,
        tabCurve: new Curve(out),
        after: prepared.after,
    };
}
```

Note: `BezierSegment` is already imported at the top of the file
(`import type { BezierSegment } from './curve.js';`). No new imports needed
in the source file.

- [ ] **Step 4: Run the anchor-removal test to verify it passes**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t "anchor-removal"`
Expected: PASS.

If `toBeLessThan` still fails (counts equal), the synthetic parent's θ is
under threshold — make `hardCurvedParent` more extreme (raise the cp1/cp2 y
from 300 toward 500) until at least one anchor drops. Do NOT weaken the
assertion.

- [ ] **Step 5: Run the whole file to confirm no regressions**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts`
Expected: PASS — including the pre-existing `smoothedTabSplicer` C1 and
differs-from-standard tests (the bridge sets the splice tangent to the exact
parent direction, so C1 still holds to 6 decimals).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/tab-generator-helpers.ts src/puzzle/topology/tab-generator-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(splicer): spread splice alignment via anchor-removal bridge

On a highly-curved parent, drop the near-splice template anchors within
an angle-scaled zone and bridge the gap with one cubic that leaves the
splice along the parent tangent, instead of forcing the whole correction
into the outermost segment. Small angles fall back to the prior
outermost-cp rotation. Traced generator only; PRNG untouched. Issue #371.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Guard tests — fallback and head preservation

**Files:**
- Test: `src/puzzle/topology/tab-generator-helpers.test.ts`

- [ ] **Step 1: Write the tests**

Add these two tests inside the existing
`describe('smoothedTabSplicer anchor-removal', ...)` block (they reuse
`makeTemplate`, `NECK_HEAVY_ANCHORS`, `farthestTabAnchor`, and
`hardCurvedParent`):

```ts
    it('keeps every anchor (fallback) on a near-straight parent', () => {
        const tmpl = makeTemplate(NECK_HEAVY_ANCHORS);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // Parent tangent ≈ template natural tangent → θ ≈ 0 → no removal.
        expect(smoothed.segments.length).toBe(standard.segments.length);
    });

    it('preserves the head anchor under a large correction', () => {
        const tmpl = makeTemplate(NECK_HEAVY_ANCHORS);
        const edge = hardCurvedParent();
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // The head (anchor farthest from the splice chord) is untouched, so
        // it appears at the same world position in both results.
        const apexStd = farthestTabAnchor(standard);
        const apexSm = farthestTabAnchor(smoothed);
        expect(apexSm.x).toBeCloseTo(apexStd.x, 3);
        expect(apexSm.y).toBeCloseTo(apexStd.y, 3);
    });
```

- [ ] **Step 2: Run to verify they pass**

Run: `npx vitest run src/puzzle/topology/tab-generator-helpers.test.ts -t "anchor-removal"`
Expected: PASS (all three tests in the block).

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/tab-generator-helpers.test.ts
git commit -m "$(cat <<'EOF'
test(splicer): cover splice-smoothing fallback and head preservation

Pins the no-removal fallback on near-straight parents and that the tab's
head anchor is never consumed by a smoothing zone. Issue #371.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full-suite verification and manual-validation handoff

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. (`npm run build` also runs `tsc`
if you want the production build path.)

- [ ] **Step 2: Confirm no PRNG / classic regression by inspection**

Verify in the diff that `alignTangentsAtSplice` adds no `random()` calls and
that nothing outside `tab-generator-helpers.ts` changed. The classic
generator uses `standardTabSplicer`, which never calls
`alignTangentsAtSplice`, so it is unaffected.

- [ ] **Step 3: Hand the manual visual check to the user**

The mechanical guarantees are covered by tests; the visual keep/tune
decision is the user's, on a dev-deploy. Tell them to reproduce the
reference puzzle from the browser console:

```js
__newComposableGame({
    seed: 1086655870,
    cols: 6, rows: 4,
    baseCutGenerator: 'sine',
    baseCutConfig: { cols: 6, rows: 4, ha: 0.5, hf: 3.2, va: 0.5, vf: 2.1 },
    tabGenerator: 'traced',
    tabConfig: {},
})
```

Expected: pieces 1 / 19 / 22 lose the sharp splice corner without new
wiggle artifacts; Wavy / classic puzzles look unchanged. If the rounding is
too weak or too strong, retune the `SPLICE_SMOOTHING_RAMP` breakpoints
(Task 1) and redeploy — no other code changes needed.

- [ ] **Step 4: No help-text change**

Per the design and the repo `CLAUDE.md` rule: this is an internal geometry
refinement with no new button, setting, gesture, or interaction, so the
info modal (`src/ui/info-modal.ts`) is intentionally left untouched.

---

## Self-Review notes

- **Spec coverage:** ramp (Task 1) ✔, anchor-removal + bridge + fallback +
  symmetry + guards (Task 2) ✔, tests incl. head preservation (Tasks 2-3) ✔,
  PRNG-untouched + classic-untouched verification (Task 4) ✔, manual
  validation snippet (Task 4) ✔, no help-text change (Task 4) ✔. Variant A is
  intentionally absent (rejected in the spec).
- **C1 preservation:** both bridges set the splice-end control point along
  the exact parent tangent (`beforeTangent` / `afterTangent`), identical to
  the source of `unitTangentLeaving(before)` / `unitTangentEntering(after)`,
  so the existing C1 test holds to 6 decimals despite the segment-count drop
  (the test derives the tab span dynamically).
- **Type consistency:** `firstSurvL` / `lastSurvR` names are consistent
  across `computeSpliceZones`, `alignTangentsAtSplice`, `buildLeftBridge`,
  and `buildRightBridge`. `spliceSmoothingChordFraction` is the single name
  used in source and tests. Bridges reference only surviving segments
  (`segs[firstSurvL]`, `segs[lastSurvR-1]`), guaranteed by the
  `lastSurvR ≥ firstSurvL + 1` guard.
