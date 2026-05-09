# Composable topology refactor 1: foundation + bug fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Composable cut style so that topology is computed once, on the input cuts, and never re-derived from modified geometry. Introduce pluggable `BaseCutGenerator` and `TabGenerator` interfaces with framework-owned collision rejection. Fix the two reported "fused piece" bugs (seeds `124741785` and `3215341677` at 1080×720) as a consequence.

**Architecture:** Today the pipeline runs bezier-js intersection three times on progressively modified curves; small floating-point disagreements between passes cause topology disagreements. The new pipeline runs intersection once on the input cuts to build a `TopologyGraph` (a thin rename of today's `DCELResult`), then applies tabs as per-edge **curve replacements** with collision rejection — topology is fixed before tabs are placed and never recomputed afterwards. The DCEL types (`Vertex`, `HalfEdge`, `Face`) are reused unchanged; the plug-in points are new.

**Tech Stack:** TypeScript, Vitest, Vite. `bezier-js` for curve math. Tests run with `npm test`; single file via `npx vitest run path/to/file.test.ts`.

**Spec:** `docs/superpowers/specs/2026-05-09-composable-topology-graph-design.md`

**Scope of this plan:** Steps 1–3 of the spec's "Order of work." The framework remains single-component and sine-grid-only — multi-component support, the Venn generator, auto-grouping, and the dead-code purge are Plans 2 and 3.

**Out of scope (deferred to later plans):**
- Multi-component DCEL and faces with holes (Plan 2).
- Two-circle Venn `BaseCutGenerator` (Plan 2).
- `minPieceArea` and auto-grouping (Plan 3).
- Deletion of `mergeTabsIntoCuts`, `resolveExcessIntersections`, `mergeSmallFaces`, `findExcessPairs` orphan logic (Plan 3 — they stay around in this plan as unused dead code, calling them is removed).

---

## File structure

**Create:**
- `src/puzzle/topology/plugin-types.ts` — `BaseCutGenerator`, `TabGenerator`, `TabPolicy`, `BaseCutGeneratorRegistry`, `TabGeneratorRegistry` interfaces
- `src/puzzle/topology/sine-cut-generator.ts` — sine-grid implementation of `BaseCutGenerator`
- `src/puzzle/topology/sine-cut-generator.test.ts` — sine generator unit tests
- `src/puzzle/topology/classic-tab-generator.ts` — wraps `classicTabTemplate` as a `TabGenerator`
- `src/puzzle/topology/classic-tab-generator.test.ts` — classic tab generator unit tests
- `src/puzzle/topology/generator-registry.ts` — id → implementation registry, with sine + classic-tab pre-registered
- `src/puzzle/topology/apply-tabs.ts` — per-edge tab application with collision rejection
- `src/puzzle/topology/apply-tabs.test.ts` — unit tests for the apply-tabs harness
- `src/puzzle/topology/repro-bug.test.ts` — integration test for the two repro seeds (initially failing)

**Modify:**
- `src/puzzle/topology/dcel.ts` — rename `DCELResult` → `TopologyGraph`; export the rename for downstream files
- `src/puzzle/topology/faces-to-pieces.ts` — update `DCELResult` import to `TopologyGraph`
- `src/puzzle/topology/generator.ts` — switch to the new pipeline (build topology once, then apply tabs); old `generateCutCurves` and `mergeTabsIntoCuts`/`resolveExcessIntersections` calls dropped from this file (the modules themselves stay, unused, until Plan 3)
- `src/puzzle/composable-generator.ts` — accept the new config shape and pass through generator ids
- `src/puzzle/composable-generator.test.ts` — adjust for new `ComposableConfig` shape
- `src/game/cut-style-strategies.ts` — pass new config shape to `generateComposablePuzzle`
- `src/model/types.ts` — `GameState['composableConfig']` shape change
- `src/sharing/share-link.ts` — extend `SharePayload['cf']` shape; add legacy-shape translator
- `src/sharing/share-link.test.ts` — round-trip new shape; legacy decode produces a working puzzle
- `src/persistence/serialization.ts` — adjust if it reads `composableConfig`
- Any other call sites that touch `composableConfig` — surfaced by `tsc --noEmit`

**Test:**
- All affected files have co-located `.test.ts` per the project convention.

---

## Verification commands

- Type check: `npx tsc --noEmit`
- All tests: `npm test`
- Single file: `npx vitest run path/to/file.test.ts`
- Single test by name fragment: `npx vitest run path/to/file.test.ts -t "fragment"`

A task is "green" when both type-check passes and the affected test files pass.

---

## Task 1: Lock in the bug fix as a failing integration test

The first concrete artifact is the test that proves we've fixed the bug. It must fail at the start of the plan and pass at Task 10.

**Files:**
- Create: `src/puzzle/topology/repro-bug.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/puzzle/topology/repro-bug.test.ts`:

```ts
/**
 * Regression tests for the "fused piece" bug at small image sizes.
 *
 * Both seeds previously produced fewer than the expected 192 pieces
 * because the pre-DCEL tab merge introduced floating-point drift
 * between cut split points, causing bezier-js to miss crossings
 * during topology construction.
 *
 * After the topology refactor, intersections are computed once on
 * the input cuts and never re-derived, so these seeds produce 192
 * pieces.
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';

describe('composable: fused-piece regression', () => {
    it('seed=124741785 (low amp / high freq) produces 192 pieces at 1080x720', () => {
        const pieces = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 124741785,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
    });

    it('seed=3215341677 (high amp) produces 192 pieces at 1080x720', () => {
        const pieces = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 3215341677,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.45, hf: 8, va: 0.45, vf: 6 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/puzzle/topology/repro-bug.test.ts
```

Expected: tests fail to compile (`generateComposablePuzzle`'s signature doesn't yet accept this config shape) **or** fail at the assertion (current behaviour: 189 / 191 pieces). Either is acceptable. The whole point is that they're red.

- [ ] **Step 3: Commit the failing test**

The failing test is the contract for the rest of the plan. Commit it explicitly.

```bash
git add src/puzzle/topology/repro-bug.test.ts
git commit -m "test(composable): lock in fused-piece regression for two repro seeds"
```

---

## Task 2: Rename `DCELResult` to `TopologyGraph`

A pure rename, no behaviour change. Establishes the new vocabulary that the rest of the plan uses.

**Files:**
- Modify: `src/puzzle/topology/dcel.ts`
- Modify: `src/puzzle/topology/faces-to-pieces.ts`
- Modify: `src/puzzle/topology/generator.ts`
- Plus any test or other file that imports `DCELResult`

- [ ] **Step 1: Find all `DCELResult` usages**

```bash
grep -rn "DCELResult" --include="*.ts" src/
```

Expected: identifies every file that imports or references the type.

- [ ] **Step 2: Rename the type at the source**

In `src/puzzle/topology/dcel.ts`, find:

```ts
/**
 * The result of building a DCEL from a set of curves.
 */
export interface DCELResult {
    vertices: Vertex[];
    halfEdges: HalfEdge[];
    faces: Face[];
    outerFace: Face;
}
```

Replace with:

```ts
/**
 * A topology graph: vertices (intersection points), half-edges
 * (oriented arcs between vertices, each carrying a curve), and faces
 * (regions enclosed by half-edge cycles).
 *
 * Implemented as a DCEL (Doubly-Connected Edge List). Built once from
 * a set of input cuts, then never re-derived — subsequent stages
 * (tab application, face → piece extraction) operate on this graph
 * directly.
 */
export interface TopologyGraph {
    vertices: Vertex[];
    halfEdges: HalfEdge[];
    faces: Face[];
    outerFace: Face;
}
```

Update `buildDCEL`'s return type from `DCELResult` to `TopologyGraph`.

- [ ] **Step 3: Update all imports and references**

For each file from Step 1, replace `DCELResult` with `TopologyGraph`. The function `buildDCEL` keeps its name in this task (rename to `buildTopologyGraph` is Task 8).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
```

Expected: clean compile, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/dcel.ts src/puzzle/topology/faces-to-pieces.ts src/puzzle/topology/generator.ts
# plus any other touched files surfaced by Step 1
git commit -m "refactor(topology): rename DCELResult to TopologyGraph"
```

---

## Task 3: Add plug-in interface types

Defines the shapes that `BaseCutGenerator` and `TabGenerator` plug-ins must satisfy, plus the registry.

**Files:**
- Create: `src/puzzle/topology/plugin-types.ts`

- [ ] **Step 1: Create the plug-in types file**

Create `src/puzzle/topology/plugin-types.ts`:

```ts
/**
 * Plug-in interfaces for the Composable framework.
 *
 * The framework owns intersection finding, topology construction,
 * tab collision rejection, and face → piece extraction. Plug-ins
 * provide the cuts (BaseCutGenerator) and the tab shapes
 * (TabGenerator). Neither plug-in sees the topology graph
 * directly — they get pure-function inputs and return pure-function
 * outputs, which the framework then validates.
 */

import type { Curve } from './curve.js';
import type { Size } from '../../model/types.js';

/**
 * Produces the input cuts for a puzzle.
 *
 * Receives the puzzle frame size, a seeded PRNG, and an opaque
 * generator-specific config object. Returns the cuts (border
 * curves AND internal cut lines).
 *
 * Convention: the FIRST four curves in the returned array are
 * always the four border lines (top, right, bottom, left), in
 * that order. The framework relies on this for tab eligibility
 * (border edges never get tabs).
 */
export interface BaseCutGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Generate the cuts.
     * @param frame - puzzle pixel dimensions
     * @param random - seeded PRNG (call counts must be deterministic
     *   per (id, config) so share-links round-trip)
     * @param config - generator-specific opaque config; the generator
     *   validates and casts internally
     */
    generate(frame: Size, random: () => number, config: unknown): Curve[];
}

/**
 * Produces a tab shape for a single edge.
 *
 * Receives the edge's current curve (the segment between the
 * edge's two vertices) and a seeded PRNG. Returns a candidate
 * curve with the SAME endpoints as the input — the framework
 * enforces this — or null to leave the edge flat.
 *
 * The candidate may protrude outside the original edge's bounding
 * box. The framework checks the candidate against all other edge
 * curves in the graph; if the candidate would introduce a new
 * crossing, the original edge is kept and the candidate discarded.
 *
 * The generator does NOT see neighbouring edges or pieces — by
 * design. Tabs that genuinely need to mesh with neighbours are
 * a BaseCutGenerator concern, not a TabGenerator concern.
 */
export interface TabGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Generate a tab candidate for the given edge curve.
     * @returns a curve with the same start/end as `edge`, or null
     *   to leave the edge flat
     */
    generate(edge: Curve, random: () => number, config: unknown): Curve | null;
}

/**
 * Optional eligibility filter for tab placement.
 *
 * Defaults to "all internal edges" (i.e. every edge whose twin
 * belongs to a non-outer face). A generator can supply a stricter
 * policy — e.g. skip edges shorter than some threshold — without
 * changing the tab generator itself.
 */
export type TabPolicy = (edge: TopologyEdge) => boolean;

/**
 * Lightweight view of a half-edge, exposed to TabPolicy.
 * Doesn't expose neighbours or curves — keeps policies simple.
 */
export interface TopologyEdge {
    readonly id: number;
    /** Arc length of the edge's current curve, in pixels. */
    readonly length: number;
    /** True if either side of the edge is the outer (unbounded) face. */
    readonly isBorder: boolean;
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit
```

Expected: clean compile (the new file isn't imported anywhere yet, but its types must be sound).

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/plugin-types.ts
git commit -m "feat(topology): add BaseCutGenerator/TabGenerator/TabPolicy interfaces"
```

---

## Task 4: Extract the sine-grid base-cut generator

Move the existing `generateCutCurves` (and its helper `generateSineCurve`) out of `topology/generator.ts` and into a `BaseCutGenerator` implementation. No behaviour change in this task; the function is just moved.

**Files:**
- Create: `src/puzzle/topology/sine-cut-generator.ts`
- Create: `src/puzzle/topology/sine-cut-generator.test.ts`
- Modify: `src/puzzle/topology/generator.ts` (still imports & calls the moved function for now)

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/sine-cut-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sineCutGenerator } from './sine-cut-generator.js';

describe('sineCutGenerator', () => {
    it('has id "sine"', () => {
        expect(sineCutGenerator.id).toBe('sine');
    });

    it('produces 4 border curves followed by internal cuts', () => {
        const random = makeSeededRandom(42);
        const curves = sineCutGenerator.generate(
            { width: 600, height: 400 },
            random,
            {
                cols: 3, rows: 2,
                ha: 0.1, hf: 1,
                va: 0.1, vf: 1,
            },
        );
        // 4 borders + (rows-1) horizontals + (cols-1) verticals = 4 + 1 + 2 = 7
        expect(curves).toHaveLength(7);
        // Borders are straight lines (1 segment each)
        expect(curves[0].segments).toHaveLength(1);
        expect(curves[1].segments).toHaveLength(1);
        expect(curves[2].segments).toHaveLength(1);
        expect(curves[3].segments).toHaveLength(1);
        // Internal cuts at frequency=1 produce >=4 segments (the curve
        // builder rounds up to multiples of 4)
        expect(curves[4].segments.length).toBeGreaterThanOrEqual(4);
    });

    it('emits straight lines when amplitude or frequency is zero', () => {
        const random = makeSeededRandom(1);
        const curves = sineCutGenerator.generate(
            { width: 100, height: 100 },
            random,
            {
                cols: 2, rows: 2,
                ha: 0, hf: 1,
                va: 1, vf: 0,
            },
        );
        // Border + horizontal + vertical = 4 + 1 + 1 = 6
        // Both internal cuts should be straight lines
        expect(curves[4].segments).toHaveLength(1);
        expect(curves[5].segments).toHaveLength(1);
    });
});

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/puzzle/topology/sine-cut-generator.test.ts
```

Expected: fails with "Cannot find module './sine-cut-generator.js'".

- [ ] **Step 3: Create the sine generator**

Create `src/puzzle/topology/sine-cut-generator.ts`. Move the bodies of `generateCutCurves` and `generateSineCurve` from `topology/generator.ts`, adapting the signatures to match the `BaseCutGenerator` interface:

```ts
/**
 * Sine-grid base-cut generator.
 *
 * Produces a rectangular grid of cuts with sine-wave perturbations
 * (the classic Composable look). Border curves come first (top,
 * right, bottom, left), followed by horizontal internal cuts,
 * followed by vertical internal cuts.
 */

import type { Size } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';

/**
 * Field names match the share-link's compact convention (`ha` for
 * horizontalAmplitude, etc.). This keeps the share-link's bgc shape
 * and the generator's expected config shape identical, so no field-
 * name translation is needed at the share-link boundary.
 */
export interface SineCutConfig {
    cols: number;
    rows: number;
    /** Horizontal cut amplitude, fraction of piece height (0–0.5). */
    ha: number;
    /** Horizontal cut frequency in waves over the puzzle width. */
    hf: number;
    /** Vertical cut amplitude, fraction of piece width (0–0.5). */
    va: number;
    /** Vertical cut frequency in waves over the puzzle height. */
    vf: number;
}

export const sineCutGenerator: BaseCutGenerator = {
    id: 'sine',

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = config as SineCutConfig;
        const { cols, rows } = cfg;
        const pieceWidth = frame.width / cols;
        const pieceHeight = frame.height / rows;
        const hPixelAmp = (cfg.ha * pieceHeight) / 2;
        const vPixelAmp = (cfg.va * pieceWidth) / 2;

        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
        ];

        // Per-cut random phase offsets — preserve PRNG call ordering
        const rowPhases: number[] = [];
        for (let r = 0; r <= rows; r++) rowPhases.push(random() * Math.PI * 2);
        const colPhases: number[] = [];
        for (let c = 0; c <= cols; c++) colPhases.push(random() * Math.PI * 2);

        for (let r = 1; r < rows; r++) {
            const y = r * pieceHeight;
            const useWave = hPixelAmp > 0 && cfg.hf > 0;
            curves.push(useWave
                ? generateSineCurve({ x: 0, y }, { x: frame.width, y },
                    hPixelAmp, cfg.hf, rowPhases[r])
                : Curve.line({ x: 0, y }, { x: frame.width, y }),
            );
        }
        for (let c = 1; c < cols; c++) {
            const x = c * pieceWidth;
            const useWave = vPixelAmp > 0 && cfg.vf > 0;
            curves.push(useWave
                ? generateSineCurve({ x, y: 0 }, { x, y: frame.height },
                    vPixelAmp, cfg.vf, colPhases[c])
                : Curve.line({ x, y: 0 }, { x, y: frame.height }),
            );
        }
        return curves;
    },
};

function generateSineCurve(
    start: { x: number; y: number },
    end: { x: number; y: number },
    amplitude: number,
    frequency: number,
    phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len, ty = dy / len;
    const px = -ty, py = tx;

    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));
    const bezierPoints: { x: number; y: number }[] = [];

    const evalSine = (t: number) => {
        const angle = 2 * Math.PI * frequency * t + phase;
        const s = amplitude * Math.sin(angle);
        const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
        return {
            x: start.x + t * dx + s * px,
            y: start.y + t * dy + s * py,
            tx: dx + ds * px,
            ty: dy + ds * py,
        };
    };

    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments, t1 = (i + 1) / totalSegments, dt = t1 - t0;
        const p0 = evalSine(t0), p1 = evalSine(t1);
        if (i === 0) bezierPoints.push({ x: p0.x, y: p0.y });
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }

    return Curve.fromBezierPath(bezierPoints);
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run src/puzzle/topology/sine-cut-generator.test.ts
```

Expected: all three tests pass.

- [ ] **Step 5: Update `topology/generator.ts` to use the moved function**

In `src/puzzle/topology/generator.ts`, replace the local `generateCutCurves` and `generateSineCurve` calls with a call into the new module. Keep the rest of `generateTopologyPuzzle` unchanged for now (full pipeline rewrite is Task 8).

Replace the existing call site:

```ts
const { curves } = generateCutCurves(
    cols, rows, imageSize, pieceWidth, pieceHeight,
    hPixelAmp, hFreq, vPixelAmp, vFreq, random,
);
```

with:

```ts
const curves = sineCutGenerator.generate(imageSize, random, {
    cols, rows,
    ha: hAmp, hf: hFreq, va: vAmp, vf: vFreq,
});
```

Add the import:

```ts
import { sineCutGenerator } from './sine-cut-generator.js';
```

Delete the now-unused `generateCutCurves` and `generateSineCurve` from `topology/generator.ts`.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm test
```

Expected: clean compile, all existing tests pass (the sine generator produces identical curves to the inlined version, so puzzle output is byte-identical).

- [ ] **Step 7: Commit**

```bash
git add src/puzzle/topology/sine-cut-generator.ts \
        src/puzzle/topology/sine-cut-generator.test.ts \
        src/puzzle/topology/generator.ts
git commit -m "refactor(topology): extract sine-grid into a BaseCutGenerator plug-in"
```

---

## Task 5: Wrap `classicTabTemplate` as a `TabGenerator`

The existing `classicTabTemplate` (in `src/puzzle/composable/tab-shapes.ts`) generates a normalised tab shape; the new `TabGenerator` interface generates a curve in world coordinates given an edge curve. The wrapper handles the transformation.

**Files:**
- Create: `src/puzzle/topology/classic-tab-generator.ts`
- Create: `src/puzzle/topology/classic-tab-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/classic-tab-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classicTabGenerator } from './classic-tab-generator.js';
import { Curve } from './curve.js';

describe('classicTabGenerator', () => {
    it('has id "classic"', () => {
        expect(classicTabGenerator.id).toBe('classic');
    });

    it('produces a curve with the same start and end as the input edge', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {});

        expect(result).not.toBeNull();
        expect(result!.start.x).toBeCloseTo(edge.start.x, 6);
        expect(result!.start.y).toBeCloseTo(edge.start.y, 6);
        expect(result!.end.x).toBeCloseTo(edge.end.x, 6);
        expect(result!.end.y).toBeCloseTo(edge.end.y, 6);
    });

    it('returns a curve that deviates from a straight line (the tab protrusion)', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {})!;

        // Sample the result and find the maximum perpendicular displacement
        const samples = result.sample(20);
        const maxAbsY = Math.max(...samples.map(p => Math.abs(p.y)));
        expect(maxAbsY).toBeGreaterThan(5); // tab protrudes meaningfully
    });

    it('returns null when the edge is too short for the tab', () => {
        const random = makeSeededRandom(42);
        // The tab template needs ~12% margin on each side; an extremely
        // short edge cannot fit it.
        const edge = Curve.line({ x: 0, y: 0 }, { x: 0.5, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {});
        expect(result).toBeNull();
    });
});

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/puzzle/topology/classic-tab-generator.test.ts
```

Expected: fails with "Cannot find module './classic-tab-generator.js'".

- [ ] **Step 3: Implement the wrapper**

Create `src/puzzle/topology/classic-tab-generator.ts`. The wrapper reuses the existing `prepareTab` logic in `topology/tab-merge.ts` (which already handles all the transformation, splice-point math, and curve assembly). We're not deleting `tab-merge.ts` yet — that's Plan 3 — we're just calling its lowest-level helper from a new entry point.

```ts
/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts as a TabGenerator plug-in.
 *
 * Reuses prepareTab/commitTab from tab-merge.ts to do the heavy
 * lifting. The wrapper picks a placement (centre position and
 * tab/socket polarity) and asks tab-merge to assemble the curve.
 *
 * Returns null when the edge is too short for the tab — same
 * conditions as the existing computeTabPlacement + prepareTab
 * sequence.
 */

import type { Curve } from './curve.js';
import { prepareTab, commitTab, computeTabPlacement, DEFAULT_TAB_PLACEMENT } from './tab-merge.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabGenerator } from './plugin-types.js';

export const classicTabGenerator: TabGenerator = {
    id: 'classic',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, classicTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run src/puzzle/topology/classic-tab-generator.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/classic-tab-generator.ts \
        src/puzzle/topology/classic-tab-generator.test.ts
git commit -m "feat(topology): wrap classicTabTemplate as a TabGenerator plug-in"
```

---

## Task 6: Generator registry

A simple id → implementation map. Bundle this with sine + classic-tab pre-registered as defaults.

**Files:**
- Create: `src/puzzle/topology/generator-registry.ts`
- Create: `src/puzzle/topology/generator-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/generator-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    getBaseCutGenerator,
    getTabGenerator,
    listBaseCutGeneratorIds,
    listTabGeneratorIds,
} from './generator-registry.js';

describe('generator-registry', () => {
    it('has the sine base-cut generator pre-registered', () => {
        expect(getBaseCutGenerator('sine').id).toBe('sine');
    });

    it('has the classic tab generator pre-registered', () => {
        expect(getTabGenerator('classic').id).toBe('classic');
    });

    it('throws on unknown base-cut id', () => {
        expect(() => getBaseCutGenerator('not-a-real-id')).toThrow(/unknown/i);
    });

    it('throws on unknown tab id', () => {
        expect(() => getTabGenerator('not-a-real-id')).toThrow(/unknown/i);
    });

    it('listBaseCutGeneratorIds returns at least "sine"', () => {
        expect(listBaseCutGeneratorIds()).toContain('sine');
    });

    it('listTabGeneratorIds returns at least "classic"', () => {
        expect(listTabGeneratorIds()).toContain('classic');
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/puzzle/topology/generator-registry.test.ts
```

Expected: fails (module not found).

- [ ] **Step 3: Implement the registry**

Create `src/puzzle/topology/generator-registry.ts`:

```ts
/**
 * Registry of base-cut and tab generator plug-ins, keyed by id.
 *
 * Pre-registers `sine` and `classic` as the framework defaults.
 * Other plug-ins (Venn etc.) register themselves at module import.
 */

import type { BaseCutGenerator, TabGenerator } from './plugin-types.js';
import { sineCutGenerator } from './sine-cut-generator.js';
import { classicTabGenerator } from './classic-tab-generator.js';

const baseCutGenerators = new Map<string, BaseCutGenerator>();
const tabGenerators = new Map<string, TabGenerator>();

export function registerBaseCutGenerator(generator: BaseCutGenerator): void {
    baseCutGenerators.set(generator.id, generator);
}

export function registerTabGenerator(generator: TabGenerator): void {
    tabGenerators.set(generator.id, generator);
}

export function getBaseCutGenerator(id: string): BaseCutGenerator {
    const g = baseCutGenerators.get(id);
    if (!g) throw new Error(`unknown BaseCutGenerator id: ${id}`);
    return g;
}

export function getTabGenerator(id: string): TabGenerator {
    const g = tabGenerators.get(id);
    if (!g) throw new Error(`unknown TabGenerator id: ${id}`);
    return g;
}

export function listBaseCutGeneratorIds(): string[] {
    return [...baseCutGenerators.keys()];
}

export function listTabGeneratorIds(): string[] {
    return [...tabGenerators.keys()];
}

// Pre-register the framework defaults
registerBaseCutGenerator(sineCutGenerator);
registerTabGenerator(classicTabGenerator);
```

- [ ] **Step 4: Run test, verify it passes**

```bash
npx vitest run src/puzzle/topology/generator-registry.test.ts
```

Expected: all six tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/generator-registry.ts \
        src/puzzle/topology/generator-registry.test.ts
git commit -m "feat(topology): generator-registry with sine + classic pre-registered"
```

---

## Task 7: Per-edge tab application with collision rejection

The framework's tab-application harness. Iterates over half-edges, asks the `TabGenerator` for a candidate, checks the candidate against all other edge curves for new crossings, and either replaces the edge's curve or leaves it flat.

**Files:**
- Create: `src/puzzle/topology/apply-tabs.ts`
- Create: `src/puzzle/topology/apply-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/puzzle/topology/apply-tabs.test.ts`:

```ts
/**
 * Tests for the per-edge tab application harness.
 *
 * The harness must:
 * - skip border edges (one side is the outer face)
 * - call the tab generator once per eligible half-edge pair
 *   (each shared edge counted once, both sides updated)
 * - reject candidates that introduce new crossings against
 *   other edge curves
 * - leave edge geometry unchanged if no candidate is acceptable
 * - preserve graph topology (vertices, half-edges, faces are
 *   unchanged in count and connectivity)
 */

import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import type { TabGenerator } from './plugin-types.js';

describe('applyTabs', () => {
    it('preserves topology — same vertex/edge/face counts after application', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const verticesBefore = graph.vertices.length;
        const halfEdgesBefore = graph.halfEdges.length;
        const facesBefore = graph.faces.length;

        applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));

        expect(graph.vertices).toHaveLength(verticesBefore);
        expect(graph.halfEdges).toHaveLength(halfEdgesBefore);
        expect(graph.faces).toHaveLength(facesBefore);
    });

    it('skips border edges (no tab applied where one side is the outer face)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        let calls = 0;
        const generator: TabGenerator = {
            id: 'count',
            generate: (edge) => { calls++; return null; },
        };
        applyTabs(graph, generator, makeSeededRandom(1));

        // 2x2 grid: 4 cells, internal edges = 4 (2 horiz + 2 vert,
        // each as a single shared edge after dedup). The outer-facing
        // border edges should not be visited.
        // Each internal shared edge is visited ONCE (not once per
        // half-edge), so calls = 4.
        expect(calls).toBe(4);
    });

    it('rejects a tab candidate that crosses another edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // A "bad" generator that always returns a curve protruding
        // far enough to cross adjacent edges.
        const protrusion = 1000;
        const badGenerator: TabGenerator = {
            id: 'bad',
            generate: (edge) => {
                const mid = edge.pointAt(0.5);
                // build a wedge that pokes way out to (mid.x, mid.y + 1000)
                return Curve.fromBezierPath([
                    edge.start,
                    edge.start,
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    edge.end,
                    edge.end,
                ]);
            },
        };

        // Snapshot one half-edge's curve before; expect it unchanged after
        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, badGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).toBe(curveBefore);
    });

    it('accepts a tab candidate that does not cross any other edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // A "good" generator: a small bump that stays well inside its
        // own edge's neighbourhood.
        const goodGenerator: TabGenerator = {
            id: 'good',
            generate: (edge) => {
                const mid = edge.pointAt(0.5);
                const start = edge.start;
                const end = edge.end;
                // Tiny perpendicular bump
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const px = -dy / len * 1; // 1 px perpendicular
                const py = dx / len * 1;
                return Curve.fromBezierPath([
                    start,
                    start,
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    end,
                    end,
                ]);
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, goodGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).not.toBe(curveBefore);
    });
});

// Helpers

function simpleGridCurves(cols: number, rows: number): Curve[] {
    const W = cols * 100, H = rows * 100;
    const curves: Curve[] = [
        Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
        Curve.line({ x: W, y: 0 }, { x: W, y: H }),
        Curve.line({ x: W, y: H }, { x: 0, y: H }),
        Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
    ];
    for (let r = 1; r < rows; r++) {
        curves.push(Curve.line({ x: 0, y: r * 100 }, { x: W, y: r * 100 }));
    }
    for (let c = 1; c < cols; c++) {
        curves.push(Curve.line({ x: c * 100, y: 0 }, { x: c * 100, y: H }));
    }
    return curves;
}

function makeFlatTabGenerator(): TabGenerator {
    return { id: 'flat', generate: () => null };
}

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/puzzle/topology/apply-tabs.test.ts
```

Expected: fails (module not found).

- [ ] **Step 3: Implement `applyTabs`**

Create `src/puzzle/topology/apply-tabs.ts`:

```ts
/**
 * Per-edge tab application with collision rejection.
 *
 * Iterates over each shared internal half-edge pair (skipping border
 * edges where one side is the outer face). For each, asks the
 * TabGenerator for a candidate curve. The candidate's endpoints must
 * match the original edge — the framework checks this and rejects
 * mismatches. Then the candidate is checked against every OTHER
 * edge in the graph for crossings; if any crossing would be
 * introduced, the candidate is rejected and the edge stays flat.
 *
 * Topology is never modified — only the `curve` field of each
 * half-edge changes (and its twin's reversed curve). Faces, vertices,
 * and connectivity are untouched.
 */

import { Curve } from './curve.js';
import type { TopologyGraph, HalfEdge } from './dcel.js';
import type { TabGenerator, TabPolicy, TopologyEdge } from './plugin-types.js';

const ENDPOINT_TOLERANCE = 0.5;          // px — candidate endpoint must match
const CROSSING_ENDPOINT_TOLERANCE = 2;   // px — ignore intersections at endpoint joins

export interface ApplyTabsOptions {
    /** Optional eligibility filter (default: every internal edge). */
    policy?: TabPolicy;
}

export function applyTabs(
    graph: TopologyGraph,
    generator: TabGenerator,
    random: () => number,
    options: ApplyTabsOptions = {},
): void {
    const policy = options.policy ?? defaultTabPolicy;

    // Build the canonical list of shared edges (one entry per twin pair).
    // Skip pairs where either side is the outer face.
    const visited = new Set<number>();
    const sharedEdges: HalfEdge[] = [];
    for (const he of graph.halfEdges) {
        if (visited.has(he.id) || visited.has(he.twin.id)) continue;
        visited.add(he.id);
        visited.add(he.twin.id);
        const aOuter = !he.face || he.face.isOuter;
        const bOuter = !he.twin.face || he.twin.face.isOuter;
        if (aOuter || bOuter) continue;
        sharedEdges.push(he);
    }

    for (const he of sharedEdges) {
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
            isBorder: false,
        };
        if (!policy(view)) continue;

        const candidate = generator.generate(he.curve, random, {});
        if (!candidate) continue;

        if (!endpointsMatch(candidate, he.curve)) continue;

        if (introducesNewCrossing(candidate, he, graph)) continue;

        he.curve = candidate;
        he.twin.curve = candidate.reverse();
    }
}

const defaultTabPolicy: TabPolicy = () => true;

function endpointsMatch(candidate: Curve, original: Curve): boolean {
    const ds = pointDist(candidate.start, original.start);
    const de = pointDist(candidate.end, original.end);
    return ds < ENDPOINT_TOLERANCE && de < ENDPOINT_TOLERANCE;
}

/**
 * Returns true if the candidate curve crosses any other edge in the
 * graph at a point that isn't already a shared endpoint of the
 * original edge.
 */
function introducesNewCrossing(
    candidate: Curve,
    self: HalfEdge,
    graph: TopologyGraph,
): boolean {
    const candStart = candidate.start;
    const candEnd = candidate.end;

    // Build the set of half-edges to check. Each twin pair is
    // checked once; we skip self and self.twin (the candidate IS
    // self's new curve).
    const seen = new Set<number>();
    for (const he of graph.halfEdges) {
        if (seen.has(he.id) || seen.has(he.twin.id)) continue;
        seen.add(he.id);
        seen.add(he.twin.id);
        if (he.id === self.id || he.id === self.twin.id) continue;

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

function pointDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
```

- [ ] **Step 4: Run test, verify all pass**

```bash
npx vitest run src/puzzle/topology/apply-tabs.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/apply-tabs.ts \
        src/puzzle/topology/apply-tabs.test.ts
git commit -m "feat(topology): apply-tabs with framework-owned collision rejection"
```

---

## Task 8: Wire the new pipeline through `topology/generator.ts`

Replace the body of `generateTopologyPuzzle` with the new pipeline. Old internal helpers (`mergeTabsIntoCuts`, `resolveExcessIntersections`, `mergeSmallFaces`) stay in their files but are no longer called.

**Files:**
- Modify: `src/puzzle/topology/generator.ts`

- [ ] **Step 1: Replace the pipeline body**

In `src/puzzle/topology/generator.ts`, replace the body of `generateTopologyPuzzle` with the new pipeline. The new function body:

First, update `TopologyGeneratorConfig` (top of `topology/generator.ts`) to drop the per-sine-parameter fields and accept opaque base/tab configs:

```ts
export interface TopologyGeneratorConfig {
    baseCutGeneratorId?: string;        // default 'sine'
    baseCutConfig?: Record<string, unknown>;
    tabGeneratorId?: string;            // default 'classic'; 'none' to skip
    tabConfig?: Record<string, unknown>;
}
```

Then the function body:

```ts
export function generateTopologyPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    random: () => number,
    config?: TopologyGeneratorConfig,
): Piece[] {
    const baseCutId = config?.baseCutGeneratorId ?? 'sine';
    const tabId = config?.tabGeneratorId ?? 'classic';

    // 1. Generate the cuts.
    const baseCutGenerator = getBaseCutGenerator(baseCutId);
    // Sine grid needs cols/rows. Other generators ignore them.
    const baseCutCfg = {
        cols, rows,
        ...(config?.baseCutConfig ?? {}),
    };
    const curves = baseCutGenerator.generate(imageSize, random, baseCutCfg);

    // 2. Build the topology graph in a single intersection pass.
    const graph = buildDCEL({ curves });

    // 3. Apply tabs per edge with collision rejection.
    if (tabId !== 'none') {
        const tabGenerator = getTabGenerator(tabId);
        applyTabs(graph, tabGenerator, random);
    }

    // 4. Faces → piece definitions. The `expectedPieceCount` arg
    //    drives the existing mergeSmallFaces logic; it stays for now
    //    and is removed in Plan 3 once auto-grouping replaces it.
    const pieceDefs = facesToPieceDefinitions(graph, cols * rows);

    // 5. Compose final pieces. Tabs are already in the geometry of
    //    each edge (when enabled); keep disableTabs:true to skip the
    //    composition layer's own tab logic.
    return composePuzzle(pieceDefs, classicTabTemplate, random, { disableTabs: true });
}
```

Update the imports at the top of the file to include `getBaseCutGenerator`, `getTabGenerator`, and `applyTabs`. Drop the imports of `mergeTabsIntoCuts`, `resolveExcessIntersections` if they remain (they may still be referenced by other code paths — check before deleting the import).

- [ ] **Step 2: Verify the existing tests still pass**

```bash
npm test
```

Expected: all existing tests pass. Some `tip-pieces.test.ts` cases may now produce slightly different topology than before (the new pipeline doesn't add lens/tip merging since it doesn't introduce extra crossings the same way), but the assertion is "exactly 24 pieces for 6×4," which the new pipeline should still satisfy. If a case fails, treat it as a real regression and investigate before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/generator.ts
git commit -m "refactor(topology): single-pass pipeline using BaseCutGenerator + applyTabs"
```

---

## Task 9: Update `composable-generator.ts` and config plumbing

Plumb the new config shape through `composable-generator.ts`, the strategy registry, and `GameState`.

**Files:**
- Modify: `src/puzzle/composable-generator.ts`
- Modify: `src/puzzle/composable-generator.test.ts` (if tests assert old config shape)
- Modify: `src/game/cut-style-strategies.ts`
- Modify: `src/model/types.ts`
- Modify: any other call sites surfaced by `tsc --noEmit`

- [ ] **Step 1: Replace `ComposableConfig`**

In `src/puzzle/composable-generator.ts`, replace:

```ts
export interface ComposableConfig {
    horizontalAmplitude?: number;
    horizontalFrequency?: number;
    verticalAmplitude?: number;
    verticalFrequency?: number;
    disableTabs?: boolean;
}
```

with:

```ts
export interface ComposableConfig {
    /** BaseCutGenerator id (e.g. 'sine'). Default: 'sine'. */
    baseCutGenerator?: string;
    /** Generator-specific config, opaque to this module. */
    baseCutConfig?: Record<string, unknown>;
    /** TabGenerator id (e.g. 'classic'). Default: 'classic'. Use 'none' to skip tabs. */
    tabGenerator?: string;
    /** Generator-specific tab config. */
    tabConfig?: Record<string, unknown>;
}
```

Update `generateComposablePuzzle` to forward the new shape opaquely:

```ts
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: ComposableConfig,
): Piece[] {
    const random = createSeededRandom(seed);
    return generateTopologyPuzzle(cols, rows, imageSize, random, {
        baseCutGeneratorId: config?.baseCutGenerator ?? 'sine',
        baseCutConfig: config?.baseCutConfig,
        tabGeneratorId: config?.tabGenerator ?? 'classic',
        tabConfig: config?.tabConfig,
    });
}
```

- [ ] **Step 2: Update `model/types.ts`**

In `src/model/types.ts`, find the `composableConfig` field on `GameState` and update its type to match the new `ComposableConfig`. If the type was inlined, replace it with `ComposableConfig` imported from `composable-generator.ts`.

- [ ] **Step 3: Update `cut-style-strategies.ts`**

In `src/game/cut-style-strategies.ts`, the strategy currently passes `ctx.composableConfig` directly to `generateComposablePuzzle`. After the type change in Step 2, that should still type-check. Run `tsc --noEmit` to verify.

If any usage site builds a `composableConfig` object literally (e.g. in a test fixture or a UI default), update it to the new shape.

- [ ] **Step 4: Track down all literal `composableConfig` usages**

```bash
grep -rn "composableConfig" --include="*.ts" src/
```

For each occurrence that constructs the object (rather than just passing it through), update to the new shape. Common pattern:

Before:
```ts
{ composableConfig: { horizontalAmplitude: 0.15, horizontalFrequency: 1.5, verticalAmplitude: 0.15, verticalFrequency: 1.5, disableTabs: false } }
```

After:
```ts
{ composableConfig: {
    baseCutGenerator: 'sine',
    baseCutConfig: { ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 },
    tabGenerator: 'classic',
    tabConfig: {},
}}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm test
```

Expected: clean compile, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/composable-generator.ts src/model/types.ts src/game/cut-style-strategies.ts
# plus other touched files
git commit -m "refactor(composable): plumb new BaseCutGenerator/TabGenerator config shape"
```

---

## Task 10: Verify the bug-fix integration test passes

The locked-in test from Task 1 should now pass without modification.

- [ ] **Step 1: Run the regression test**

```bash
npx vitest run src/puzzle/topology/repro-bug.test.ts
```

Expected: both seeds produce 192 pieces. Both tests pass.

- [ ] **Step 2: Run the full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit (if any fixup needed)**

If the previous tasks already had the test passing as a side-effect of their commits, this step is a no-op. If a final tweak was needed (e.g. tightening a tolerance), commit it now:

```bash
git commit --allow-empty -m "test(composable): verify fused-piece regression fixed"
```

---

## Task 11: Extend the share-link format

Add the new `cf` shape (generator ids + per-generator configs) and the legacy translator that converts the old shape on decode.

**Files:**
- Modify: `src/sharing/share-link.ts`
- Modify: `src/sharing/share-link.test.ts`

- [ ] **Step 1: Write the new round-trip test**

In `src/sharing/share-link.test.ts`, add (don't replace existing tests):

```ts
describe('share-link: composable v2 cf shape', () => {
    it('round-trips the new {bg, bgc, tg, tgc} shape', () => {
        const payload: SharePayload = {
            v: 1,
            i: 'blank',
            is: [600, 400],
            g: [4, 3],
            c: 'composable',
            s: 12345,
            r: 'none',
            cf: {
                bg: 'sine',
                bgc: { ha: 0.2, hf: 1.5, va: 0.2, vf: 1.5 },
                tg: 'classic',
                tgc: {},
            },
        } as SharePayload;
        const encoded = encodePayload(payload);
        const decoded = decodePayload(encoded);
        expect(decoded).toEqual(payload);
    });
});

describe('share-link: legacy composable cf shape', () => {
    it('decodes a legacy {ha, hf, va, vf, dt} payload as the new shape', () => {
        // Hand-construct an old-format payload and encode it.
        const legacy = {
            v: 1, i: 'blank', is: [600, 400], g: [4, 3],
            c: 'composable', s: 12345, r: 'none',
            cf: { ha: 0.2, hf: 1.5, va: 0.2, vf: 1.5, dt: false },
        };
        const encoded = encodePayload(legacy as unknown as SharePayload);
        const decoded = decodePayload(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.cf).toEqual({
            bg: 'sine',
            bgc: { ha: 0.2, hf: 1.5, va: 0.2, vf: 1.5 },
            tg: 'classic',
            tgc: {},
        });
    });

    it('decodes a legacy payload with dt=true as tg="none"', () => {
        const legacy = {
            v: 1, i: 'blank', is: [600, 400], g: [4, 3],
            c: 'composable', s: 12345, r: 'none',
            cf: { ha: 0.2, hf: 1.5, va: 0.2, vf: 1.5, dt: true },
        };
        const encoded = encodePayload(legacy as unknown as SharePayload);
        const decoded = decodePayload(encoded);
        expect(decoded!.cf!.tg).toBe('none');
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: the new tests fail (the new shape isn't yet supported by the type or decoder).

- [ ] **Step 3: Update the `SharePayload` type**

In `src/sharing/share-link.ts`, replace the `cf` field shape:

```ts
/** Composable cut config. */
cf?: {
    /** BaseCutGenerator id. */
    bg: string;
    /** Generator-specific config (opaque). */
    bgc: Record<string, unknown>;
    /** TabGenerator id ('none' to disable tabs). */
    tg: string;
    /** Tab-generator-specific config (opaque). */
    tgc: Record<string, unknown>;
    /** Optional minPieceArea override (Plan 3 will use this). */
    mpa?: number;
};
```

- [ ] **Step 4: Add the legacy translator in `decodePayload`**

In `src/sharing/share-link.ts`, modify `decodePayload`:

```ts
export function decodePayload(encoded: string): SharePayload | null {
    try {
        const json = base64UrlDecode(encoded);
        const parsed = JSON.parse(json) as unknown;
        const translated = translateLegacyComposable(parsed);
        if (!isValidPayload(translated)) return null;
        return translated;
    } catch {
        return null;
    }
}

/**
 * Translate a legacy composable cf shape (with ha/hf/va/vf/dt fields)
 * into the new shape (bg/bgc/tg/tgc) so the framework only ever sees
 * the new format.
 */
function translateLegacyComposable(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const p = parsed as Record<string, unknown>;
    if (p.c !== 'composable') return parsed;
    if (!p.cf || typeof p.cf !== 'object') return parsed;

    const cf = p.cf as Record<string, unknown>;
    // Detect legacy shape by the presence of any of the legacy keys
    // and the absence of the new keys.
    const isLegacy = ('ha' in cf || 'hf' in cf || 'va' in cf || 'vf' in cf || 'dt' in cf)
                  && !('bg' in cf);
    if (!isLegacy) return parsed;

    return {
        ...p,
        cf: {
            bg: 'sine',
            bgc: {
                ha: cf.ha, hf: cf.hf, va: cf.va, vf: cf.vf,
            },
            tg: cf.dt === true ? 'none' : 'classic',
            tgc: {},
        },
    };
}
```

- [ ] **Step 5: Update `isValidPayload`**

Replace the existing `cf`-related validation with the new shape's validator:

```ts
function isValidComposableCf(cf: unknown): boolean {
    if (!cf || typeof cf !== 'object') return false;
    const c = cf as Record<string, unknown>;
    if (typeof c.bg !== 'string') return false;
    if (typeof c.bgc !== 'object' || c.bgc === null) return false;
    if (typeof c.tg !== 'string') return false;
    if (typeof c.tgc !== 'object' || c.tgc === null) return false;
    if (c.mpa !== undefined && typeof c.mpa !== 'number') return false;
    return true;
}
```

Wire it into `isValidPayload`:

```ts
if (p.c === 'composable' && p.cf !== undefined && !isValidComposableCf(p.cf)) return false;
```

- [ ] **Step 6: Update `assertPayloadNumbersFinite`**

The function currently checks `cf.ha`, `cf.hf`, etc. Update it to walk the new shape:

```ts
if (payload.cf && payload.c === 'composable') {
    const bgc = payload.cf.bgc as Record<string, unknown>;
    for (const key of Object.keys(bgc)) {
        const v = bgc[key];
        if (typeof v === 'number' && !Number.isFinite(v)) {
            throw new Error(`Share payload cf.bgc.${key} must be finite (got ${v})`);
        }
    }
}
```

- [ ] **Step 7: Run tests, verify they pass**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: new round-trip tests pass; legacy decode tests pass; existing tests continue to pass (the legacy translator is invisible to anything that doesn't use the legacy shape).

- [ ] **Step 8: Update the encode side**

The encoder receives a `SharePayload` with the new `cf` shape (because `composable-generator.ts` produces it). Verify nothing in `encodePayload` blocks the new shape, then add tests covering encode of the new shape (the round-trip test in Step 1 already covers this).

- [ ] **Step 9: Surface usages in `main.ts` / wherever payloads are built**

```bash
grep -rn "cf:" --include="*.ts" src/
```

For each builder of `SharePayload.cf`, switch to the new shape. Common pattern: wherever `cutStyle === 'composable'` builds `cf` from `state.composableConfig`, the builder maps `composableConfig` (already in new shape after Task 9) onto `cf` (also new shape) — usually a 1:1 rename.

- [ ] **Step 10: Verify**

```bash
npx tsc --noEmit
npm test
```

Expected: clean compile, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts src/main.ts
# plus any other touched files
git commit -m "feat(sharing): extend cf shape with generator ids; legacy translator"
```

---

## Task 12: End-to-end smoke test for legacy share-link decode

Belt-and-braces: the legacy translator in `share-link.ts` should produce a payload that the rest of the pipeline accepts and runs without crashing, even if the resulting puzzle differs from what the legacy version produced.

**Files:**
- Create or extend: `src/sharing/share-link.test.ts` (or `src/main.test.ts` if there's an integration entry point there)

- [ ] **Step 1: Write the smoke test**

Add to `src/sharing/share-link.test.ts`:

```ts
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';

describe('share-link: legacy → working puzzle smoke test', () => {
    it('a legacy-shape link decodes and produces a non-empty piece array', () => {
        const legacy = {
            v: 1, i: 'blank', is: [1080, 720], g: [16, 12],
            c: 'composable', s: 124741785, r: 'none',
            cf: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9, dt: false },
        };
        const encoded = encodePayload(legacy as unknown as SharePayload);
        const decoded = decodePayload(encoded)!;

        const pieces = generateComposablePuzzle(
            decoded.g[0], decoded.g[1],
            { width: decoded.is[0], height: decoded.is[1] },
            decoded.s,
            {
                baseCutGenerator: decoded.cf!.bg,
                baseCutConfig: decoded.cf!.bgc,
                tabGenerator: decoded.cf!.tg,
                tabConfig: decoded.cf!.tgc,
            },
        );

        expect(pieces.length).toBeGreaterThan(0);
        // We don't assert exactly 192 — old links won't necessarily
        // produce the same puzzle. We just assert "produces a puzzle."
    });
});
```

- [ ] **Step 2: Run, verify it passes**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: smoke test passes. Combined with Task 11's tests, the legacy contract is fully covered.

- [ ] **Step 3: Final whole-suite verification**

```bash
npx tsc --noEmit
npm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/sharing/share-link.test.ts
git commit -m "test(sharing): legacy share-link decodes to a working puzzle"
```

---

## Done — Plan 1 acceptance check

Before declaring this plan complete, verify:

- [ ] `npx vitest run src/puzzle/topology/repro-bug.test.ts` — both seeds produce 192 pieces.
- [ ] `npm test` — all tests pass.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `mergeTabsIntoCuts`, `resolveExcessIntersections`, `mergeSmallFaces` are all still in their files but have **zero call sites in production code paths**. Verify with: `grep -n "mergeTabsIntoCuts\|resolveExcessIntersections" src/puzzle/topology/generator.ts` — should return nothing. Their existing tests still run them directly; that's fine and stays until Plan 3.
- [ ] In-app smoke test: `npm run dev`, generate a Composable puzzle from the new-game dialog using the legacy UI's parameter sliders, verify it produces a coherent puzzle visually.
- [ ] Share-link smoke test: take an old share link from chat history, paste it into the dev URL, verify it decodes and produces a coherent puzzle.

If all green, this plan is done; the framework is now single-pass-intersection, plug-in-driven, and free of the original two bugs. Plans 2 and 3 follow.
