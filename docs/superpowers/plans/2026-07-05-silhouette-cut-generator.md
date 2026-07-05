# Silhouette Cut Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only composable base cut (`silhouette`) that traces salient color-coherent regions in the puzzle image as knife-edge outline cuts, keeps small regions whole, and subdivides everything else with the sine lattice.

**Architecture:** A pure segmentation pipeline (`src/puzzle/silhouette/`) turns downscaled image pixels into closed Bézier outlines before generation; a new `BaseCutGenerator` merges those outlines with a delegated sine lattice (clipped out of whole blobs); a small framework extension (`Curve.suppressTabs`) keeps outline edges tab-less. Outlines are injected transiently via `StrategyContext` (the `tabDebug` pattern) and never persisted.

**Tech Stack:** TypeScript, Vite, Vitest, bezier-js (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-silhouette-cut-generator-design.md`

## Global Constraints

- American English in all identifiers and comments (`color`, not `colour`).
- New seeded randomness must follow the sub-PRNG rule: exactly ONE outer `random()` call seeds a local `createSeededRandom` stream (see repo CLAUDE.md).
- The first 4 curves returned by any `BaseCutGenerator` MUST be the border lines (top, right, bottom, left).
- `SilhouetteOutline[]` runtime data must NEVER be assigned onto `GameState.composableConfig` (that object is serialized into saves and the `cf` share block).
- Test files live next to the source they test.
- Dev-only feature: no info-modal changes, no analytics.
- Working branch: `feat/silhouette-cut-generator` off `main` (main is PR-protected).
- Run `npx vitest run <file>` for single files; `npm test` / `npx tsc --noEmit` before finishing a task is cheap insurance.

---

### Task 1: Spike — DCEL behavior for T-junctions and dangling stubs

The clipping strategy in Task 8 depends on how `buildDCEL` treats (a) a curve that *ends exactly on* another curve (T-junction) and (b) a curve end that dangles inside a face. This spike is a permanent test file documenting the framework behavior we rely on.

**Files:**
- Create: `src/puzzle/topology/dcel-junction.test.ts`

**Interfaces:**
- Consumes: `buildDCEL` from `./dcel.js`, `Curve` from `./curve.js`.
- Produces: knowledge only — the Task 8 clipping code follows the branch this test proves. Both outcomes are handled in Task 8's design; the test pins whichever holds.

- [ ] **Step 1: Write the spike test**

```typescript
/**
 * Framework-behavior spike for the silhouette generator's lattice
 * clipping (see docs/superpowers/specs/2026-07-05-silhouette-cut-
 * generator-design.md). Pins how buildDCEL treats:
 *
 * 1. T-junctions: a curve ENDING exactly on another curve must split
 *    the other curve and produce a shared vertex (within
 *    VERTEX_MERGE_TOLERANCE = 3px).
 * 2. Dangling stubs: a curve end floating inside a face must not
 *    corrupt face discovery (the faces around it must still close).
 */
import { describe, it, expect } from 'vitest';
import { buildDCEL } from './dcel.js';
import { Curve } from './curve.js';

const border = (w: number, h: number): Curve[] => [
    Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
    Curve.line({ x: w, y: 0 }, { x: w, y: h }),
    Curve.line({ x: w, y: h }, { x: 0, y: h }),
    Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
];

describe('DCEL junction behavior (silhouette clipping contract)', () => {
    it('splits a crossed curve at a T-junction endpoint', () => {
        // Vertical line ends exactly ON the horizontal midline.
        const curves = [
            ...border(100, 100),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),   // full horizontal
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 50 }),    // T-stem from top
        ];
        const graph = buildDCEL({ curves });
        const inner = graph.faces.filter(f => !f.isOuter);
        // Top-left, top-right, bottom = 3 inner faces if the T-junction
        // created a real vertex; 2 if the stem was ignored/dangling.
        expect(inner.length).toBe(3);
        // A vertex must exist at (50, 50).
        const v = graph.vertices.find(v =>
            Math.hypot(v.position.x - 50, v.position.y - 50) < 3);
        expect(v).toBeDefined();
    });

    it('documents dangling-stub behavior (stub ends mid-face)', () => {
        // Vertical stub crosses the midline and continues 5px past it.
        const curves = [
            ...border(100, 100),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 55 }),    // 5px overshoot
        ];
        const graph = buildDCEL({ curves });
        const inner = graph.faces.filter(f => !f.isOuter);
        // The crossing at (50,50) must still split the top half into two
        // faces. Assert face count and record (via the assertion values)
        // whether the 5px stub corrupts the bottom face.
        expect(inner.length).toBeGreaterThanOrEqual(3);
        // Every inner face's boundary must be a closed loop.
        for (const face of inner) {
            let e = face.outerEdge;
            let steps = 0;
            do { e = e.next; steps++; } while (e !== face.outerEdge && steps < 10_000);
            expect(e).toBe(face.outerEdge);
        }
    });
});
```

- [ ] **Step 2: Run the spike**

Run: `npx vitest run src/puzzle/topology/dcel-junction.test.ts`

Expected: both tests PASS or the second FAILS informatively. **Record the outcome:**
- If the T-junction test passes → Task 8 clips lattice curves *exactly at* the intersection t (no overshoot). This is the expected outcome given dcel.ts's documented "T-junction dedup".
- If only the dangling-stub variant behaves (T-junction fails but stub faces stay closed) → Task 8 over-extends kept spans by `CLIP_OVERSHOOT_PX = 2` past the intersection.
- If both fail → stop and consult the spec's fallback (snap clipped endpoints within `VERTEX_MERGE_TOLERANCE`); raise with the reviewer before proceeding.

Adjust the failing test to *assert the actual behavior* with a comment explaining it (the file documents reality, not aspiration).

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/dcel-junction.test.ts
git commit -m "test(topology): pin DCEL T-junction and dangling-stub behavior"
```

---

### Task 2: `Curve.suppressTabs` + tab-policy plumbing

**Files:**
- Modify: `src/puzzle/topology/curve.ts` (constructor, `splitAt`, `splitAtSegmentLocal`, `reverse`, factory methods)
- Modify: `src/puzzle/topology/plugin-types.ts` (`TopologyEdge`)
- Modify: `src/puzzle/topology/apply-tabs.ts` (view build + default policy)
- Test: `src/puzzle/topology/curve.test.ts` (extend existing), `src/puzzle/topology/apply-tabs.test.ts` (extend existing)

**Interfaces:**
- Produces: `new Curve(segments, { suppressTabs: true })`; `curve.suppressTabs: boolean` (readonly, default `false`); `Curve.line(a, b, opts?)`, `Curve.fromBezierPath(points, opts?)`; `TopologyEdge.suppressTabs: boolean`. Task 8's generator flags outline curves with it; the DCEL's internal splitting (which uses `splitAtSegmentLocal`/`splitAt`) propagates it to every derived edge automatically.

- [ ] **Step 1: Write failing tests**

Append to `src/puzzle/topology/curve.test.ts`:

```typescript
describe('suppressTabs propagation', () => {
    it('defaults to false and is set via options', () => {
        expect(Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 }).suppressTabs).toBe(false);
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 }, { suppressTabs: true });
        expect(c.suppressTabs).toBe(true);
    });

    it('survives splitAt, splitAtSegmentLocal, and reverse', () => {
        const c = Curve.circle({ x: 0, y: 0 }, 10);
        const flagged = new Curve([...c.segments], { suppressTabs: true });
        const [a, b] = flagged.splitAt(0.5);
        expect(a.suppressTabs).toBe(true);
        expect(b.suppressTabs).toBe(true);
        const [d, e] = flagged.splitAtSegmentLocal(1, 0.5);
        expect(d.suppressTabs).toBe(true);
        expect(e.suppressTabs).toBe(true);
        expect(flagged.reverse().suppressTabs).toBe(true);
    });
});
```

Append to `src/puzzle/topology/apply-tabs.test.ts` (match the file's existing helper style for building a small graph — a 100×100 border plus one internal line is enough):

```typescript
it('never puts a tab on an edge derived from a suppressTabs curve', () => {
    // Two internal cuts: one normal, one suppressed. Both cross the frame.
    const curves = [
        Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
        Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
        Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
        Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
        Curve.line({ x: 0, y: 33 }, { x: 100, y: 33 }),
        Curve.line({ x: 0, y: 66 }, { x: 100, y: 66 }, { suppressTabs: true }),
    ];
    const graph = buildDCEL({ curves });
    const before = new Map(graph.halfEdges.map(he => [he.id, he.curve]));
    applyTabs(graph, classicTabGenerator, createSeededRandom(42), {});
    for (const he of graph.halfEdges) {
        if (he.curve.suppressTabs) {
            expect(he.curve).toBe(before.get(he.id)); // untouched
        }
    }
    // Sanity: at least one non-suppressed edge DID get a tab.
    const changed = graph.halfEdges.some(he => he.curve !== before.get(he.id));
    expect(changed).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/topology/curve.test.ts src/puzzle/topology/apply-tabs.test.ts`
Expected: FAIL — `suppressTabs` does not exist / options param rejected.

- [ ] **Step 3: Implement**

In `curve.ts`:

```typescript
/** Options accepted by the Curve constructor and factories. */
export interface CurveOptions {
    /**
     * When true, edges derived from this curve are never given tabs
     * (see apply-tabs.ts). Set by generators for cuts that must stay
     * knife-edged (e.g. silhouette outlines). Propagated through
     * splitAt / splitAtSegmentLocal / reverse, so every DCEL segment
     * of a flagged input curve inherits it.
     */
    suppressTabs?: boolean;
}

export class Curve {
    readonly segments: readonly BezierSegment[];
    /** See {@link CurveOptions.suppressTabs}. */
    readonly suppressTabs: boolean;

    constructor(segments: BezierSegment[], options?: CurveOptions) {
        if (segments.length === 0) {
            throw new Error('Curve must have at least one segment');
        }
        this.segments = segments;
        this.suppressTabs = options?.suppressTabs ?? false;
    }
```

Then thread the flag through every `new Curve(...)` inside the class, and give the factories an options param:

- `static line(start, end, options?: CurveOptions)` → `new Curve([...], options)`
- `static fromBezierPath(points, options?: CurveOptions)` → `new Curve(segments, options)`
- `static circle(center, radius, options?: CurveOptions)` → pass `options` through its `fromBezierPath` call
- In `splitAt`: every `return` constructs with `{ suppressTabs: this.suppressTabs }` — including the degenerate `Curve.line(this.start, this.start, { suppressTabs: this.suppressTabs })` branches
- In `splitAtSegmentLocal`: same for all four construction sites
- In `reverse()`: `return new Curve(reversed, { suppressTabs: this.suppressTabs });`

In `plugin-types.ts`, extend the view (keep the doc comment style):

```typescript
export interface TopologyEdge {
    readonly id: number;
    readonly length: number;
    /** True when the edge derives from a suppressTabs input curve. */
    readonly suppressTabs: boolean;
}
```

In `apply-tabs.ts`:

```typescript
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
            suppressTabs: he.curve.suppressTabs,
        };
```

```typescript
const defaultTabPolicy: TabPolicy = (edge) => !edge.suppressTabs;
```

Note: `dcel.ts` needs no changes — `splitCurvesAtIntersections` and `splitClosedCurves` both split via the two `Curve` split methods, which now propagate the flag.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/puzzle/topology/ && npx tsc --noEmit`
Expected: all PASS (including pre-existing topology tests — the options params are additive), no type errors. If other `TopologyEdge` literal sites exist (`grep -rn "TopologyEdge" src/`), add `suppressTabs: false` there.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/
git commit -m "feat(topology): per-curve tab suppression via Curve.suppressTabs"
```

---

### Task 3: Silhouette types + Oklab conversion + median-cut quantization

**Files:**
- Create: `src/puzzle/silhouette/types.ts`
- Create: `src/puzzle/silhouette/quantize.ts`
- Test: `src/puzzle/silhouette/quantize.test.ts`

**Interfaces:**
- Produces:
  - `SilhouetteParams { colorLevels, maxRegions, minRegionFrac, maxRegionFrac, allowAdjacent, simplifyTolerancePx, smoothing }` and `DEFAULT_SILHOUETTE_PARAMS`.
  - `SilhouetteOutline { path: Point[]; polygon: Point[]; area: number }` — `path` is a closed cubic-Bézier path (3n+1 points, first === last) in frame coordinates; `polygon` the simplified pre-smoothing polygon (containment tests); `area` in frame px².
  - `Raster { width: number; height: number; data: Uint8ClampedArray }` — RGBA, same layout as `ImageData` (usable in Node tests without canvas).
  - `rgbToOklab(r, g, b): [number, number, number]` (0–255 in, perceptual triple out).
  - `quantize(raster: Raster, levels: number): { labels: Int32Array; palette: Array<[number, number, number]> }` — per-pixel palette index via deterministic median-cut in Oklab space.

- [ ] **Step 1: Write `types.ts`** (types only — no test)

```typescript
/**
 * Shared types for the silhouette segmentation pipeline.
 *
 * Everything here is pure data. The pipeline runs OUTSIDE the seeded
 * generation path (pre-generation, async) and must be deterministic
 * for a given pixel buffer — no randomness anywhere in this module.
 */
import type { Point } from '../../model/types.js';

/** Segmentation tuning; every field maps to a dev slider. */
export interface SilhouetteParams {
    /** Median-cut palette size (2–32). */
    colorLevels: number;
    /** Maximum number of regions to trace (0–20). */
    maxRegions: number;
    /** Minimum region area as a fraction of the frame (0–1). */
    minRegionFrac: number;
    /** Maximum region area as a fraction of the frame (0–1). */
    maxRegionFrac: number;
    /** Allow tracing two adjacent regions (sliver risk; see spec). */
    allowAdjacent: boolean;
    /** Douglas-Peucker tolerance in frame px (hard floor: 2). */
    simplifyTolerancePx: number;
    /** Contour smoothing strength 0–1 (0 = polygon, 1 = full Catmull-Rom). */
    smoothing: number;
}

export const DEFAULT_SILHOUETTE_PARAMS: SilhouetteParams = {
    colorLevels: 8,
    maxRegions: 5,
    minRegionFrac: 0.01,
    maxRegionFrac: 0.25,
    allowAdjacent: false,
    simplifyTolerancePx: 4,
    smoothing: 0.8,
};

/** A traced region outline, in puzzle-frame coordinates. */
export interface SilhouetteOutline {
    /** Closed cubic-Bézier path: 3n+1 points, first === last. */
    path: Point[];
    /** Simplified polygon (pre-smoothing) for containment tests. */
    polygon: Point[];
    /** Region area in frame px² (scaled from the raster mask). */
    area: number;
}

/** RGBA pixel buffer with the same layout as ImageData (Node-testable). */
export interface Raster {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}
```

- [ ] **Step 2: Write failing quantize tests**

```typescript
import { describe, it, expect } from 'vitest';
import { rgbToOklab, quantize } from './quantize.js';
import type { Raster } from './types.js';

/** Build a raster from a rows-of-hex-colors spec, e.g. ['rrggbb', ...] per pixel. */
function raster(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Raster {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = fill(x, y);
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
    }
    return { width, height, data };
}

describe('rgbToOklab', () => {
    it('maps black below white in lightness', () => {
        expect(rgbToOklab(0, 0, 0)[0]).toBeLessThan(rgbToOklab(255, 255, 255)[0]);
    });
    it('is deterministic', () => {
        expect(rgbToOklab(120, 30, 200)).toEqual(rgbToOklab(120, 30, 200));
    });
});

describe('quantize', () => {
    it('separates two clearly distinct colors into two labels', () => {
        // Left half red, right half blue.
        const r = raster(8, 4, x => (x < 4 ? [220, 30, 30] : [30, 30, 220]));
        const { labels, palette } = quantize(r, 2);
        expect(palette.length).toBe(2);
        expect(labels[0]).not.toBe(labels[7]);           // red vs blue pixel
        expect(labels[0]).toBe(labels[3]);               // within red half
        expect(labels[4]).toBe(labels[7]);               // within blue half
    });
    it('is deterministic for identical input', () => {
        const r = raster(16, 16, (x, y) => [x * 15, y * 15, (x + y) * 7]);
        const a = quantize(r, 8);
        const b = quantize(r, 8);
        expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    });
    it('caps the palette at the requested level count', () => {
        const r = raster(16, 16, (x, y) => [x * 15, y * 15, 0]);
        expect(quantize(r, 4).palette.length).toBeLessThanOrEqual(4);
    });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/puzzle/silhouette/quantize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `quantize.ts`**

```typescript
/**
 * Deterministic color quantization for silhouette segmentation.
 *
 * sRGB → Oklab (perceptual), then median-cut to a small palette.
 * Median-cut is deterministic by construction (no seeding, no
 * iterative convergence), which is why it was chosen over k-means —
 * see the design spec's reproducibility section.
 */
import type { Raster } from './types.js';

/** sRGB (0–255 per channel) → Oklab [L, a, b]. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
    // sRGB → linear
    const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lr = lin(r), lg = lin(g), lb = lin(b);
    // linear sRGB → LMS (Oklab M1), cube root, → Oklab (M2)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

interface Bucket {
    /** Pixel indices (into width*height space) in this bucket. */
    pixels: number[];
}

/**
 * Median-cut quantization in Oklab space.
 *
 * Repeatedly splits the bucket with the widest Oklab channel range at
 * that channel's median until `levels` buckets exist (or no bucket is
 * splittable). Ties are broken by lowest bucket index — deterministic.
 */
export function quantize(
    raster: Raster,
    levels: number,
): { labels: Int32Array; palette: Array<[number, number, number]> } {
    const n = raster.width * raster.height;
    // Precompute Oklab per pixel (3 floats per pixel).
    const lab = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
        const [L, a, b] = rgbToOklab(
            raster.data[i * 4], raster.data[i * 4 + 1], raster.data[i * 4 + 2],
        );
        lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
    }

    const buckets: Bucket[] = [{ pixels: Array.from({ length: n }, (_, i) => i) }];

    const channelRange = (bucket: Bucket, ch: number): number => {
        let min = Infinity, max = -Infinity;
        for (const p of bucket.pixels) {
            const v = lab[p * 3 + ch];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return max - min;
    };

    while (buckets.length < levels) {
        // Pick the bucket×channel with the widest range (first wins ties).
        let bestBucket = -1, bestChannel = 0, bestRange = 1e-9;
        for (let bi = 0; bi < buckets.length; bi++) {
            if (buckets[bi].pixels.length < 2) continue;
            for (let ch = 0; ch < 3; ch++) {
                const range = channelRange(buckets[bi], ch);
                if (range > bestRange) {
                    bestRange = range; bestBucket = bi; bestChannel = ch;
                }
            }
        }
        if (bestBucket < 0) break; // nothing splittable

        const bucket = buckets[bestBucket];
        const ch = bestChannel;
        // Sort by channel value with pixel index as deterministic tiebreak.
        bucket.pixels.sort((a, b) =>
            (lab[a * 3 + ch] - lab[b * 3 + ch]) || (a - b));
        const mid = bucket.pixels.length >> 1;
        buckets.splice(bestBucket, 1,
            { pixels: bucket.pixels.slice(0, mid) },
            { pixels: bucket.pixels.slice(mid) });
    }

    const labels = new Int32Array(n);
    const palette: Array<[number, number, number]> = [];
    for (let bi = 0; bi < buckets.length; bi++) {
        let sl = 0, sa = 0, sb = 0;
        for (const p of buckets[bi].pixels) {
            labels[p] = bi;
            sl += lab[p * 3]; sa += lab[p * 3 + 1]; sb += lab[p * 3 + 2];
        }
        const count = buckets[bi].pixels.length || 1;
        palette.push([sl / count, sa / count, sb / count]);
    }
    return { labels, palette };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/puzzle/silhouette/quantize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/silhouette/
git commit -m "feat(silhouette): Oklab median-cut quantization"
```

---

### Task 4: Connected components + region statistics

**Files:**
- Create: `src/puzzle/silhouette/regions.ts`
- Test: `src/puzzle/silhouette/regions.test.ts`

**Interfaces:**
- Consumes: `quantize` labels (`Int32Array`), palette (`Array<[number,number,number]>`), raster dims.
- Produces:

```typescript
export interface Region {
    id: number;                    // component id (0-based, scan order — deterministic)
    area: number;                  // pixel count in the working raster
    meanColor: [number, number, number]; // Oklab (palette entry of its label)
    touchesFrame: boolean;
    neighbors: Set<number>;        // adjacent component ids (4-connectivity)
    /** Mean Oklab distance to neighboring components, area-weighted. */
    contrast: number;
}
export function findRegions(
    width: number, height: number,
    labels: Int32Array,
    palette: Array<[number, number, number]>,
): { regions: Region[]; componentMap: Int32Array }
```

`componentMap` maps each pixel to its component id (needed for contour tracing in Task 6).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { findRegions } from './regions.js';

/** labels grid from strings: '0011' rows → Int32Array. */
function grid(rows: string[]): { width: number; height: number; labels: Int32Array } {
    const height = rows.length, width = rows[0].length;
    const labels = new Int32Array(width * height);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) labels[y * width + x] = Number(row[x]);
    });
    return { width, height, labels };
}

const PALETTE: Array<[number, number, number]> = [
    [0.2, 0, 0], [0.8, 0, 0], [0.5, 0.1, -0.1],
];

describe('findRegions', () => {
    it('separates same-label areas that are not connected', () => {
        const g = grid([
            '00100',
            '00100',
            '00100',
        ]);
        // Label 0 appears as two components (left and right of the 1-stripe).
        const { regions } = findRegions(g.width, g.height, g.labels, PALETTE);
        expect(regions.length).toBe(3);
    });

    it('computes area, frame contact, and adjacency', () => {
        const g = grid([
            '000000',
            '011000',
            '011000',
            '000000',
        ]);
        const { regions, componentMap } = findRegions(g.width, g.height, g.labels, PALETTE);
        expect(regions.length).toBe(2);
        const inner = regions.find(r => r.area === 4)!;
        const outer = regions.find(r => r.area === 20)!;
        expect(inner.touchesFrame).toBe(false);
        expect(outer.touchesFrame).toBe(true);
        expect(inner.neighbors.has(outer.id)).toBe(true);
        expect(outer.neighbors.has(inner.id)).toBe(true);
        // componentMap covers every pixel.
        expect(componentMap.length).toBe(24);
    });

    it('gives an isolated high-contrast region a higher contrast score', () => {
        const g = grid([
            '000000',
            '011000',
            '011220',
            '002220',
            '000000',
        ]);
        const { regions } = findRegions(g.width, g.height, g.labels, PALETTE);
        const r1 = regions.find(r => r.meanColor[0] === 0.8)!; // label 1: far from 0
        const r2 = regions.find(r => r.meanColor[0] === 0.5)!; // label 2: nearer 0
        expect(r1.contrast).toBeGreaterThan(r2.contrast);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/silhouette/regions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `regions.ts`**

```typescript
/**
 * Connected-component analysis over a quantized label map.
 *
 * 4-connectivity flood fill in scan order (deterministic ids), then
 * per-component stats: area, frame contact, neighbor set, and a
 * contrast score (mean Oklab distance to surrounding components,
 * weighted by shared-border length) used by the selection stage to
 * rank "salient" blobs above same-size background patches.
 */

export interface Region {
    id: number;
    area: number;
    meanColor: [number, number, number];
    touchesFrame: boolean;
    neighbors: Set<number>;
    contrast: number;
}

export function findRegions(
    width: number,
    height: number,
    labels: Int32Array,
    palette: Array<[number, number, number]>,
): { regions: Region[]; componentMap: Int32Array } {
    const n = width * height;
    const componentMap = new Int32Array(n).fill(-1);
    const regions: Region[] = [];
    const stack: number[] = [];

    for (let start = 0; start < n; start++) {
        if (componentMap[start] !== -1) continue;
        const id = regions.length;
        const label = labels[start];
        let area = 0;
        let touchesFrame = false;
        stack.push(start);
        componentMap[start] = id;
        while (stack.length > 0) {
            const p = stack.pop()!;
            area++;
            const x = p % width, y = (p / width) | 0;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                touchesFrame = true;
            }
            // 4-neighbors
            if (x > 0)          visit(p - 1);
            if (x < width - 1)  visit(p + 1);
            if (y > 0)          visit(p - width);
            if (y < height - 1) visit(p + width);
        }
        regions.push({
            id, area,
            meanColor: palette[label],
            touchesFrame,
            neighbors: new Set<number>(),
            contrast: 0,
        });

        function visit(q: number): void {
            if (componentMap[q] === -1 && labels[q] === label) {
                componentMap[q] = id;
                stack.push(q);
            }
        }
    }

    // Adjacency + border-weighted contrast in one pass over pixel pairs.
    const borderLen = new Map<string, number>(); // "a,b" a<b → shared border px
    const bump = (a: number, b: number): void => {
        if (a === b) return;
        regions[a].neighbors.add(b);
        regions[b].neighbors.add(a);
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        borderLen.set(key, (borderLen.get(key) ?? 0) + 1);
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (x < width - 1) bump(componentMap[p], componentMap[p + 1]);
            if (y < height - 1) bump(componentMap[p], componentMap[p + width]);
        }
    }
    for (const region of regions) {
        let weighted = 0, total = 0;
        for (const nb of region.neighbors) {
            const key = region.id < nb ? `${region.id},${nb}` : `${nb},${region.id}`;
            const w = borderLen.get(key) ?? 0;
            weighted += w * oklabDist(region.meanColor, regions[nb].meanColor);
            total += w;
        }
        region.contrast = total > 0 ? weighted / total : 0;
    }

    return { regions, componentMap };
}

function oklabDist(a: [number, number, number], b: [number, number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/puzzle/silhouette/regions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/silhouette/regions.ts src/puzzle/silhouette/regions.test.ts
git commit -m "feat(silhouette): connected components with contrast scoring"
```

---

### Task 5: Region selection (score, filter, adjacency rule)

**Files:**
- Create: `src/puzzle/silhouette/select.ts`
- Test: `src/puzzle/silhouette/select.test.ts`

**Interfaces:**
- Consumes: `Region[]` from Task 4; `SilhouetteParams` from Task 3.
- Produces: `selectRegions(regions: Region[], rasterArea: number, params: SilhouetteParams): Region[]` — the regions to trace, in descending score order.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { selectRegions } from './select.js';
import type { Region } from './regions.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';

function region(partial: Partial<Region> & { id: number }): Region {
    return {
        area: 100, meanColor: [0.5, 0, 0], touchesFrame: false,
        neighbors: new Set(), contrast: 0.1, ...partial,
    };
}

const params = { ...DEFAULT_SILHOUETTE_PARAMS, maxRegions: 2, minRegionFrac: 0.01, maxRegionFrac: 0.5 };
const RASTER_AREA = 10_000;

describe('selectRegions', () => {
    it('drops frame-touching regions', () => {
        const picked = selectRegions([
            region({ id: 0, touchesFrame: true, contrast: 1 }),
            region({ id: 1 }),
        ], RASTER_AREA, params);
        expect(picked.map(r => r.id)).toEqual([1]);
    });

    it('enforces min/max area bounds', () => {
        const picked = selectRegions([
            region({ id: 0, area: 50 }),      // 0.5% < 1% min
            region({ id: 1, area: 6000 }),    // 60% > 50% max
            region({ id: 2, area: 500 }),
        ], RASTER_AREA, params);
        expect(picked.map(r => r.id)).toEqual([2]);
    });

    it('ranks by area × contrast', () => {
        const picked = selectRegions([
            region({ id: 0, area: 400, contrast: 0.05 }),  // score 20
            region({ id: 1, area: 300, contrast: 0.2 }),   // score 60
        ], RASTER_AREA, params);
        expect(picked[0].id).toBe(1);
    });

    it('skips regions adjacent to an already-picked one when allowAdjacent is false', () => {
        const a = region({ id: 0, contrast: 0.3, neighbors: new Set([1]) });
        const b = region({ id: 1, contrast: 0.2, neighbors: new Set([0]) });
        const c = region({ id: 2, contrast: 0.1 });
        expect(selectRegions([a, b, c], RASTER_AREA, params).map(r => r.id)).toEqual([0, 2]);
        expect(selectRegions([a, b, c], RASTER_AREA, { ...params, allowAdjacent: true })
            .map(r => r.id)).toEqual([0, 1]);
    });

    it('caps at maxRegions', () => {
        const rs = [0, 1, 2, 3].map(id => region({ id, contrast: 0.1 + id * 0.01 }));
        expect(selectRegions(rs, RASTER_AREA, params).length).toBe(2);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/silhouette/select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `select.ts`**

```typescript
/**
 * Region selection for silhouette tracing.
 *
 * Score = area × contrast (a mid-sized high-contrast parrot must
 * outrank a huge low-contrast sky patch). Frame-touching regions are
 * dropped outright (their contours would run near-parallel to the
 * border lines and produce sliver faces — see the spec's hazards
 * table). With `allowAdjacent` off, a region adjacent to an already-
 * selected one is skipped for the same sliver reason.
 */
import type { Region } from './regions.js';
import type { SilhouetteParams } from './types.js';

export function selectRegions(
    regions: Region[],
    rasterArea: number,
    params: SilhouetteParams,
): Region[] {
    const minArea = params.minRegionFrac * rasterArea;
    const maxArea = params.maxRegionFrac * rasterArea;

    const candidates = regions
        .filter(r => !r.touchesFrame && r.area >= minArea && r.area <= maxArea)
        // Deterministic ordering: score desc, id asc as tiebreak.
        .sort((a, b) => (b.area * b.contrast - a.area * a.contrast) || (a.id - b.id));

    const picked: Region[] = [];
    const blocked = new Set<number>();
    for (const candidate of candidates) {
        if (picked.length >= params.maxRegions) break;
        if (!params.allowAdjacent && blocked.has(candidate.id)) continue;
        picked.push(candidate);
        for (const nb of candidate.neighbors) blocked.add(nb);
    }
    return picked;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/puzzle/silhouette/select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/silhouette/select.ts src/puzzle/silhouette/select.test.ts
git commit -m "feat(silhouette): salience-ranked region selection"
```

---

### Task 6: Contour tracing + simplification + smoothing

**Files:**
- Create: `src/puzzle/silhouette/contour.ts`
- Test: `src/puzzle/silhouette/contour.test.ts`

**Interfaces:**
- Consumes: `componentMap` from Task 4.
- Produces:
  - `traceContour(width, height, componentMap, regionId): Point[]` — closed polygon (first !== last; implicit closure) along pixel boundaries in raster coordinates, interior on the left.
  - `simplifyClosed(points: Point[], tolerance: number): Point[]` — Douglas-Peucker for closed loops.
  - `smoothClosed(points: Point[], strength: number): Point[]` — closed Catmull-Rom→Bézier path (3n+1 points, first === last). `strength = 0` returns the polygon as degenerate Béziers.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { traceContour, simplifyClosed, smoothClosed } from './contour.js';

/** componentMap grid from strings ('.'=0, '#'=1). */
function cmap(rows: string[]): { width: number; height: number; map: Int32Array } {
    const height = rows.length, width = rows[0].length;
    const map = new Int32Array(width * height);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) map[y * width + x] = row[x] === '#' ? 1 : 0;
    });
    return { width, height, map };
}

describe('traceContour', () => {
    it('traces a 2×2 block as its 4-corner square', () => {
        const g = cmap([
            '....',
            '.##.',
            '.##.',
            '....',
        ]);
        const poly = traceContour(g.width, g.height, g.map, 1);
        // The boundary rectangle corners (1,1) (3,1) (3,3) (1,3), any start.
        expect(poly.length).toBe(4);
        const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
        expect(new Set(poly.map(key))).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']));
    });

    it('walks an L-shape without self-crossing and closes the loop', () => {
        const g = cmap([
            '.....',
            '.#...',
            '.##..',
            '.....',
        ]);
        const poly = traceContour(g.width, g.height, g.map, 1);
        expect(poly.length).toBe(6); // L-shape has 6 corners
        // Signed area non-zero (valid simple polygon).
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            area += a.x * b.y - b.x * a.y;
        }
        expect(Math.abs(area / 2)).toBe(3); // 3 pixels
    });
});

describe('simplifyClosed', () => {
    it('collapses collinear points', () => {
        const square = [
            { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
            { x: 2, y: 2 }, { x: 0, y: 2 },
        ];
        expect(simplifyClosed(square, 0.1).length).toBe(4);
    });
    it('keeps genuine corners at low tolerance', () => {
        const l = [
            { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
            { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
        ];
        expect(simplifyClosed(l, 0.1)).toEqual(l);
    });
});

describe('smoothClosed', () => {
    it('produces a closed 3n+1 Bézier path', () => {
        const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const path = smoothClosed(square, 0.8);
        expect((path.length - 1) % 3).toBe(0);
        expect(path[0]).toEqual(path[path.length - 1]);
        expect((path.length - 1) / 3).toBe(4); // one segment per polygon edge
    });
    it('strength 0 passes through the polygon corners', () => {
        const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const path = smoothClosed(square, 0);
        expect(path[0]).toEqual({ x: 0, y: 0 });
        expect(path[3]).toEqual({ x: 10, y: 0 });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/silhouette/contour.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `contour.ts`**

```typescript
/**
 * Contour extraction for a traced region: boundary walk along pixel
 * edges, Douglas-Peucker simplification, Catmull-Rom smoothing.
 *
 * Coordinates are RASTER coordinates throughout; the caller scales to
 * frame space. All three stages are deterministic.
 */
import type { Point } from '../../model/types.js';

/**
 * Trace the outer boundary of a component as a closed polygon.
 *
 * Walks directed pixel-edge segments with the region interior on the
 * LEFT. At each corner the walker prefers the tightest left turn,
 * which keeps diagonal-touch cases (two region pixels meeting only at
 * a corner) on the outer boundary rather than crossing through.
 * Collinear steps are merged, so the result contains corners only.
 * First point is the region's topmost-leftmost boundary corner.
 */
export function traceContour(
    width: number,
    height: number,
    componentMap: Int32Array,
    regionId: number,
): Point[] {
    const inside = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < width && y < height &&
        componentMap[y * width + x] === regionId;

    // Find the topmost-leftmost inside pixel. We walk boundary edges with
    // the region interior on the RIGHT of travel, then reverse at the end
    // so the returned polygon has interior on the LEFT.
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (inside(x, y)) { sx = x; sy = y; break outer; }
        }
    }
    if (sx < 0) return [];

    // Directions: 0=right, 1=down, 2=left, 3=up. Position = lattice corner.
    // For a unit edge leaving corner (cx,cy) in direction d, the adjacent
    // pixels are (derived per direction — do not compute one from the
    // other via reversal; the tables are corner-anchored and asymmetric):
    //   d=0 edge (cx,cy)→(cx+1,cy): left=(cx,cy-1)   right=(cx,cy)
    //   d=1 edge (cx,cy)→(cx,cy+1): left=(cx,cy)     right=(cx-1,cy)
    //   d=2 edge (cx,cy)→(cx-1,cy): left=(cx-1,cy)   right=(cx-1,cy-1)
    //   d=3 edge (cx,cy)→(cx,cy-1): left=(cx-1,cy-1) right=(cx,cy-1)
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const LEFT_DX = [0, 0, -1, -1],  LEFT_DY = [-1, 0, 0, -1];
    const RIGHT_DX = [0, -1, -1, 0], RIGHT_DY = [0, 0, -1, -1];
    const isBoundaryEdge = (cx: number, cy: number, d: number): boolean =>
        !inside(cx + LEFT_DX[d], cy + LEFT_DY[d]) &&
        inside(cx + RIGHT_DX[d], cy + RIGHT_DY[d]);

    // Start at the top-left corner of the first pixel, heading right:
    // left = (sx, sy-1) is outside (topmost row), right = (sx, sy) is
    // inside — a valid interior-on-right boundary edge.
    const startX = sx, startY = sy, startD = 0;
    const corners: Point[] = [];
    let cx = startX, cy = startY, d = startD;
    let guard = 0;
    const maxSteps = width * height * 8;
    do {
        corners.push({ x: cx, y: cy });
        // Advance one lattice step.
        cx += DX[d]; cy += DY[d];
        // Choose the next boundary edge. Prefer the turn TOWARD the
        // interior (right turn under interior-on-right), then straight,
        // then away — this keeps diagonal-touch corners from producing a
        // self-crossing walk. With y-down screen coords and the direction
        // ring 0→1→2→3 being right→down→left→up, "toward the interior"
        // is (d+1)%4.
        const turns = [(d + 1) % 4, d, (d + 3) % 4, (d + 2) % 4];
        let chosen = -1;
        for (const nd of turns) {
            if (isBoundaryEdge(cx, cy, nd)) { chosen = nd; break; }
        }
        if (chosen < 0) break; // defensive: malformed map
        d = chosen;
        guard++;
    } while ((cx !== startX || cy !== startY || d !== startD) && guard < maxSteps);

    // Merge collinear runs (the walk pushes every lattice corner).
    const merged: Point[] = [];
    for (let i = 0; i < corners.length; i++) {
        const prev = corners[(i - 1 + corners.length) % corners.length];
        const cur = corners[i];
        const next = corners[(i + 1) % corners.length];
        const collinear = (cur.x - prev.x) * (next.y - cur.y)
                       === (cur.y - prev.y) * (next.x - cur.x);
        if (!collinear) merged.push(cur);
    }

    // Interior currently on the right (clockwise in screen coords, which is
    // positive shoelace with y-down). Reverse to interior-on-left so hole
    // orientation matches the DCEL's expectations for island components.
    let area = 0;
    for (let i = 0; i < merged.length; i++) {
        const a = merged[i], b = merged[(i + 1) % merged.length];
        area += a.x * b.y - b.x * a.y;
    }
    if (area > 0) merged.reverse();
    return merged;
}

/** Douglas-Peucker on a closed loop: anchor at the two farthest-apart points. */
export function simplifyClosed(points: Point[], tolerance: number): Point[] {
    if (points.length <= 4) return [...points];
    // Farthest pair by scanning from point 0 (adequate + deterministic).
    let far = 1, best = -1;
    for (let i = 1; i < points.length; i++) {
        const d = dist(points[0], points[i]);
        if (d > best) { best = d; far = i; }
    }
    const half1 = dpSimplify([...points.slice(0, far + 1)], tolerance);
    const half2 = dpSimplify([...points.slice(far), points[0]], tolerance);
    return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

function dpSimplify(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;
    const first = points[0], last = points[points.length - 1];
    let index = -1, maxDist = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDist(points[i], first, last);
        if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist <= tolerance) return [first, last];
    const left = dpSimplify(points.slice(0, index + 1), tolerance);
    const right = dpSimplify(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
}

function perpendicularDist(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return dist(p, a);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function dist(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Closed Catmull-Rom → cubic Bézier path through the polygon corners.
 * `strength` scales the tangent handles: 0 = straight edges (degenerate
 * Béziers), 1 = full Catmull-Rom smoothness.
 * Returns 3n+1 points with first === last (Curve.fromBezierPath format).
 */
export function smoothClosed(points: Point[], strength: number): Point[] {
    const n = points.length;
    const path: Point[] = [points[0]];
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        const s = strength / 6;
        path.push(
            { x: p1.x + (p2.x - p0.x) * s, y: p1.y + (p2.y - p0.y) * s },
            { x: p2.x - (p3.x - p1.x) * s, y: p2.y - (p3.y - p1.y) * s },
            { x: p2.x, y: p2.y },
        );
    }
    return path;
}
```

- [ ] **Step 4: Run tests; fix the walker if the L-shape test fails**

Run: `npx vitest run src/puzzle/silhouette/contour.test.ts`
Expected: PASS. The boundary walker is the fiddliest code in this plan — if the corner-count assertions fail, debug by printing the walked corners for the 2×2 case (expected walk: (1,1)→(3,1)→(3,3)→(1,3)); the usual bug is the left/right pixel table for one direction.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/silhouette/contour.ts src/puzzle/silhouette/contour.test.ts
git commit -m "feat(silhouette): contour tracing with simplify and smooth"
```

---

### Task 7: Pipeline orchestration + canvas wrapper with degradation

**Files:**
- Create: `src/puzzle/silhouette/segment-image.ts` (pure orchestration)
- Create: `src/puzzle/silhouette/compute-outlines.ts` (browser/canvas wrapper)
- Test: `src/puzzle/silhouette/segment-image.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces:
  - `segmentImage(raster: Raster, frame: Size, params: SilhouetteParams): SilhouetteOutline[]` — pure, deterministic; outlines in FRAME coordinates.
  - `computeSilhouetteOutlines(imageUrl: string, frame: Size, params: Partial<SilhouetteParams>): Promise<SilhouetteOutline[]>` — loads the image, downscales onto an offscreen canvas (max width `SEGMENTATION_RASTER_WIDTH = 256`), runs `segmentImage`. Returns `[]` (with `console.warn`) on ANY failure: tainted canvas, decode error, zero regions.
  - `silhouetteParamsFromConfig(config: Record<string, unknown> | undefined): SilhouetteParams` — reads the compact bgc keys (`cl`, `mr`, `mnf`, `mxf`, `aa`, `st`, `sm`), applies defaults and clamps (`simplifyTolerancePx` floor 2, `colorLevels` 2–32, `maxRegions` 0–20, fracs 0–1, smoothing 0–1). Used by both the wrapper and the share-link decode clamp (Task 11 references the same bounds).

- [ ] **Step 1: Write failing tests for `segmentImage` and `silhouetteParamsFromConfig`**

```typescript
import { describe, it, expect } from 'vitest';
import { segmentImage, silhouetteParamsFromConfig } from './segment-image.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';
import type { Raster } from './types.js';

/** 64×48 gray background with a 16×12 red block at (24, 18). */
function testRaster(): Raster {
    const width = 64, height = 48;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const red = x >= 24 && x < 40 && y >= 18 && y < 30;
            const i = (y * width + x) * 4;
            data[i] = red ? 220 : 128;
            data[i + 1] = red ? 30 : 128;
            data[i + 2] = red ? 30 : 128;
            data[i + 3] = 255;
        }
    }
    return { width, height, data };
}

describe('segmentImage', () => {
    const frame = { width: 640, height: 480 };  // 10× raster scale
    const params = { ...DEFAULT_SILHOUETTE_PARAMS, colorLevels: 2, maxRegions: 3, smoothing: 0 };

    it('finds the red block and scales it to frame coordinates', () => {
        const outlines = segmentImage(testRaster(), frame, params);
        expect(outlines.length).toBe(1);
        const [o] = outlines;
        // Raster block corners (24,18)-(40,30) → frame (240,180)-(400,300).
        const xs = o.polygon.map(p => p.x), ys = o.polygon.map(p => p.y);
        expect(Math.min(...xs)).toBeCloseTo(240, 0);
        expect(Math.max(...xs)).toBeCloseTo(400, 0);
        expect(Math.min(...ys)).toBeCloseTo(180, 0);
        expect(Math.max(...ys)).toBeCloseTo(300, 0);
        expect(o.area).toBeCloseTo(160 * 120, -2);
        // Closed Bézier path in fromBezierPath format.
        expect((o.path.length - 1) % 3).toBe(0);
        expect(o.path[0]).toEqual(o.path[o.path.length - 1]);
    });

    it('returns [] for a uniform raster', () => {
        const flat: Raster = testRaster();
        flat.data.fill(128);
        for (let i = 3; i < flat.data.length; i += 4) flat.data[i] = 255;
        expect(segmentImage(flat, frame, params)).toEqual([]);
    });

    it('is deterministic', () => {
        const a = segmentImage(testRaster(), frame, params);
        const b = segmentImage(testRaster(), frame, params);
        expect(a).toEqual(b);
    });
});

describe('silhouetteParamsFromConfig', () => {
    it('applies defaults for missing fields', () => {
        expect(silhouetteParamsFromConfig(undefined)).toEqual(DEFAULT_SILHOUETTE_PARAMS);
        expect(silhouetteParamsFromConfig({})).toEqual(DEFAULT_SILHOUETTE_PARAMS);
    });
    it('reads compact keys and clamps hostile values', () => {
        const p = silhouetteParamsFromConfig({
            cl: 999, mr: -5, mnf: 2, mxf: -1, aa: true, st: 0.001, sm: 7,
        });
        expect(p.colorLevels).toBe(32);
        expect(p.maxRegions).toBe(0);
        expect(p.minRegionFrac).toBe(1);
        expect(p.maxRegionFrac).toBe(0);
        expect(p.allowAdjacent).toBe(true);
        expect(p.simplifyTolerancePx).toBe(2);   // hard floor
        expect(p.smoothing).toBe(1);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/silhouette/segment-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `segment-image.ts`**

```typescript
/**
 * Pure silhouette segmentation pipeline: quantize → components →
 * select → contour → simplify → smooth → scale to frame space.
 *
 * Deterministic for a given raster. The canvas-touching wrapper lives
 * in compute-outlines.ts so this module stays Node-testable.
 */
import type { Size } from '../../model/types.js';
import { quantize } from './quantize.js';
import { findRegions } from './regions.js';
import { selectRegions } from './select.js';
import { traceContour, simplifyClosed, smoothClosed } from './contour.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';
import type { Raster, SilhouetteOutline, SilhouetteParams } from './types.js';

export function segmentImage(
    raster: Raster,
    frame: Size,
    params: SilhouetteParams,
): SilhouetteOutline[] {
    const { labels, palette } = quantize(raster, params.colorLevels);
    const { regions, componentMap } = findRegions(
        raster.width, raster.height, labels, palette,
    );
    const picked = selectRegions(regions, raster.width * raster.height, params);

    const scaleX = frame.width / raster.width;
    const scaleY = frame.height / raster.height;
    // Simplify in raster space: convert the frame-px tolerance down.
    const rasterTolerance = params.simplifyTolerancePx / Math.max(scaleX, scaleY);

    const outlines: SilhouetteOutline[] = [];
    for (const region of picked) {
        const contour = traceContour(
            raster.width, raster.height, componentMap, region.id,
        );
        if (contour.length < 4) continue; // too small to be a real outline
        const simplified = simplifyClosed(contour, rasterTolerance);
        if (simplified.length < 3) continue;
        const polygon = simplified.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        const path = smoothClosed(polygon, params.smoothing);
        outlines.push({
            path,
            polygon,
            area: region.area * scaleX * scaleY,
        });
    }
    return outlines;
}

/**
 * Read SilhouetteParams from an opaque bgc config record (compact
 * share-link keys), clamping every field to its safe range. The
 * simplify-tolerance floor (2px) is the curve-count budget: a crafted
 * st=0.001 would otherwise feed thousands of Bézier segments into the
 * O(n²) DCEL intersection pass.
 */
export function silhouetteParamsFromConfig(
    config: Record<string, unknown> | undefined,
): SilhouetteParams {
    const d = DEFAULT_SILHOUETTE_PARAMS;
    const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const clamp = (v: number, lo: number, hi: number): number =>
        Math.min(hi, Math.max(lo, v));
    return {
        colorLevels: clamp(Math.round(num(config?.cl, d.colorLevels)), 2, 32),
        maxRegions: clamp(Math.round(num(config?.mr, d.maxRegions)), 0, 20),
        minRegionFrac: clamp(num(config?.mnf, d.minRegionFrac), 0, 1),
        maxRegionFrac: clamp(num(config?.mxf, d.maxRegionFrac), 0, 1),
        allowAdjacent: config?.aa === true,
        simplifyTolerancePx: clamp(num(config?.st, d.simplifyTolerancePx), 2, 64),
        smoothing: clamp(num(config?.sm, d.smoothing), 0, 1),
    };
}
```

Note: `allowAdjacent` defaults to `false` when absent, which diverges from `DEFAULT_SILHOUETTE_PARAMS.allowAdjacent` only if that default ever changes from `false` — the first test locks them equal today.

- [ ] **Step 4: Implement `compute-outlines.ts`** (no unit test — thin canvas glue, covered by manual smoke; keep ALL logic in `segment-image.ts`)

```typescript
/**
 * Browser wrapper for the silhouette pipeline: load the puzzle image,
 * downscale onto an offscreen canvas, run the pure segmentation.
 *
 * Runs pre-generation (async), mirroring preloadTracedTabGenerator's
 * position in the new-game and share-link flows. On ANY failure —
 * tainted canvas (non-CORS share-link image), decode error, zero
 * regions — it degrades to [] so the generator falls back to a plain
 * sine lattice instead of failing the puzzle.
 */
import type { Size } from '../../model/types.js';
import { segmentImage, silhouetteParamsFromConfig } from './segment-image.js';
import type { SilhouetteOutline } from './types.js';

/** Working-raster width; height follows the frame aspect. */
const SEGMENTATION_RASTER_WIDTH = 256;

export async function computeSilhouetteOutlines(
    imageUrl: string,
    frame: Size,
    baseCutConfig: Record<string, unknown> | undefined,
): Promise<SilhouetteOutline[]> {
    try {
        const img = await loadImage(imageUrl);
        const width = Math.min(SEGMENTATION_RASTER_WIDTH, Math.max(2, Math.round(frame.width)));
        const height = Math.max(2, Math.round(width * (frame.height / frame.width)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return [];
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height); // throws if tainted
        const params = silhouetteParamsFromConfig(baseCutConfig);
        return segmentImage(
            { width, height, data: imageData.data }, frame, params,
        );
    } catch (err) {
        console.warn('[silhouette] segmentation failed; using plain lattice', err);
        return [];
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`image load failed: ${url}`));
        img.src = url;
    });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/puzzle/silhouette/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/silhouette/
git commit -m "feat(silhouette): segmentation pipeline with canvas wrapper"
```

---

### Task 8: The `silhouette` base-cut generator

**Files:**
- Create: `src/puzzle/topology/silhouette-cut-generator.ts`
- Modify: `src/puzzle/topology/generator-registry.ts` (register)
- Test: `src/puzzle/topology/silhouette-cut-generator.test.ts`

**Interfaces:**
- Consumes: `SilhouetteOutline` from Task 3; `Curve` options from Task 2; `sineCutGenerator` via `getBaseCutGenerator('sine')`; `createSeededRandom` from `../seeded-random.js`.
- Produces: `silhouetteCutGenerator: BaseCutGenerator` with `id: 'silhouette'`. Config shape (opaque record):

```typescript
export interface SilhouetteCutConfig {
    cols: number;               // injected by generator.ts from the grid
    rows: number;
    ha?: number; hf?: number;   // forwarded to the sine sub-generator
    va?: number; vf?: number;
    /** Whole-piece threshold as a multiple of average piece area. */
    wp?: number;                // default 3
    /** Runtime-injected outlines — NEVER persisted (see spec). */
    outlines?: SilhouetteOutline[];
}
```

PRNG contract: exactly ONE outer `random()` call, always, regardless of config/outlines.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { silhouetteCutGenerator } from './silhouette-cut-generator.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { classicTabGenerator } from './classic-tab-generator.js';
import { createSeededRandom } from '../seeded-random.js';
import type { SilhouetteOutline } from '../silhouette/types.js';

const FRAME = { width: 400, height: 300 };

/** Small square blob outline centered at (200, 150), 40×40. */
function squareOutline(cx = 200, cy = 150, half = 20): SilhouetteOutline {
    const polygon = [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
    ];
    // Degenerate Béziers (straight edges): 3n+1 with first === last.
    const path = [polygon[0]];
    for (let i = 0; i < 4; i++) {
        const a = polygon[i], b = polygon[(i + 1) % 4];
        path.push(
            { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
            { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 },
            { x: b.x, y: b.y },
        );
    }
    return { path, polygon, area: (half * 2) ** 2 };
}

function generate(config: Record<string, unknown>) {
    return silhouetteCutGenerator.generate(FRAME, createSeededRandom(7), {
        cols: 4, rows: 3, ...config,
    });
}

describe('silhouetteCutGenerator', () => {
    it('is registered', () => {
        expect(getBaseCutGenerator('silhouette')).toBe(silhouetteCutGenerator);
    });

    it('emits 4 border curves first and a sine lattice with no outlines', () => {
        const curves = generate({});
        expect(curves.length).toBe(4 + 2 + 3); // border + (rows-1) h + (cols-1) v
        expect(curves[0].start).toEqual({ x: 0, y: 0 });
    });

    it('always draws exactly one outer PRNG value', () => {
        const count = (config: Record<string, unknown>): number => {
            let calls = 0;
            const counting = () => { calls++; return createSeededRandom(7 + calls)(); };
            silhouetteCutGenerator.generate(FRAME, counting, { cols: 4, rows: 3, ...config });
            return calls;
        };
        expect(count({})).toBe(1);
        expect(count({ outlines: [squareOutline()] })).toBe(1);
        expect(count({ ha: 0.4, hf: 3 })).toBe(1);
    });

    it('flags outline curves suppressTabs and lattice curves not', () => {
        const curves = generate({ outlines: [squareOutline()] });
        const suppressed = curves.filter(c => c.suppressTabs);
        const normal = curves.filter(c => !c.suppressTabs);
        expect(suppressed.length).toBeGreaterThan(0);
        expect(normal.length).toBeGreaterThanOrEqual(4);
    });

    it('a small (whole) blob yields exactly one piece with all edges tab-less', () => {
        // avg piece area = 400*300/12 = 10_000; blob 1600 < 3×10_000 → whole.
        const curves = generate({ outlines: [squareOutline()] });
        const graph = buildDCEL({ curves });
        applyTabs(graph, classicTabGenerator, createSeededRandom(9), {});
        // No lattice curve may pass through the blob interior: no half-edge
        // midpoint strictly inside the square except the outline's own edges.
        for (const he of graph.halfEdges) {
            const mid = he.curve.pointAt(0.5);
            const insideBlob = mid.x > 181 && mid.x < 219 && mid.y > 131 && mid.y < 169;
            if (insideBlob) {
                expect(he.curve.suppressTabs).toBe(true);
            }
        }
        // The blob face exists: one inner face whose area ≈ 1600.
        const areas = graph.faces.filter(f => !f.isOuter).map(faceArea);
        expect(areas.some(a => Math.abs(a - 1600) < 100)).toBe(true);
    });

    it('a large blob keeps the lattice inside (subdivided)', () => {
        // 200×200 blob = 40_000 > 3×10_000 → subdivided.
        const curves = generate({ outlines: [squareOutline(200, 150, 100)] });
        const graph = buildDCEL({ curves });
        // Some non-suppressed edge midpoint lies inside the blob.
        const inside = graph.halfEdges.some(he => {
            const mid = he.curve.pointAt(0.5);
            return !he.curve.suppressTabs &&
                mid.x > 110 && mid.x < 290 && mid.y > 60 && mid.y < 240;
        });
        expect(inside).toBe(true);
    });

    it('is deterministic for the same seed and outlines', () => {
        const a = generate({ outlines: [squareOutline()] });
        const b = generate({ outlines: [squareOutline()] });
        expect(a.map(c => c.segments)).toEqual(b.map(c => c.segments));
    });
});

function faceArea(face: { outerEdge: { origin: { position: { x: number; y: number } }; twin: { origin: { position: { x: number; y: number } } }; next: unknown } }): number {
    let area = 0;
    let cur = face.outerEdge as { origin: { position: { x: number; y: number } }; next: never };
    const start = cur;
    do {
        const next = (cur as { next: typeof cur }).next;
        const a = cur.origin.position, b = next.origin.position;
        area += a.x * b.y - b.x * a.y;
        cur = next;
    } while (cur !== start);
    return Math.abs(area / 2);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/puzzle/topology/silhouette-cut-generator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generator**

```typescript
/**
 * Silhouette base-cut generator.
 *
 * Combines runtime-injected image-trace outlines (see
 * src/puzzle/silhouette/) with a delegated sine lattice:
 *
 *   - Every outline becomes a suppressTabs cut, so its edges stay
 *     knife-edged through applyTabs.
 *   - Outlines smaller than the whole-piece threshold stay WHOLE:
 *     lattice curves are clipped out of their interior (the DCEL's
 *     T-junction handling shares the cut vertices — see
 *     dcel-junction.test.ts).
 *   - Larger outlines are subdivided: the lattice passes through, and
 *     the outline still becomes real cuts.
 *
 * PRNG contract: exactly ONE outer random() call (sub-PRNG rule from
 * the repo CLAUDE.md); the sine delegate consumes only the local
 * stream. The `outlines` config field is runtime-injected by the
 * composable strategy and NEVER persisted (design spec, persistence
 * boundary).
 */
import type { Point, Size } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { createSeededRandom } from '../seeded-random.js';
import type { SilhouetteOutline } from '../silhouette/types.js';

export interface SilhouetteCutConfig {
    cols: number;
    rows: number;
    ha?: number; hf?: number; va?: number; vf?: number;
    /** Whole-piece threshold, multiple of average piece area (default 3). */
    wp?: number;
    /** Runtime-injected outlines — never persisted. */
    outlines?: SilhouetteOutline[];
}

const DEFAULT_WHOLE_PIECE_FACTOR = 3;

function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

export const silhouetteCutGenerator: BaseCutGenerator = {
    id: 'silhouette',

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<SilhouetteCutConfig>;
        const cols = cfg.cols ?? 1;
        const rows = cfg.rows ?? 1;

        // ONE outer draw; everything below uses the local stream.
        const local = createSeededRandom(seedFromFloat(random()));

        const border: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
        ];

        // Delegate the lattice to sine; drop its 4 border duplicates.
        const sine = getBaseCutGenerator('sine');
        const lattice = sine.generate(frame, local, {
            cols, rows,
            ha: cfg.ha, hf: cfg.hf, va: cfg.va, vf: cfg.vf,
        }).slice(4);

        const outlines = cfg.outlines ?? [];
        const avgPieceArea = (frame.width * frame.height) / (cols * rows);
        const wholeMaxArea =
            (cfg.wp ?? DEFAULT_WHOLE_PIECE_FACTOR) * avgPieceArea;

        const outlineCurves: Curve[] = [];
        const wholeBlobs: SilhouetteOutline[] = [];
        for (const outline of outlines) {
            outlineCurves.push(
                Curve.fromBezierPath(outline.path, { suppressTabs: true }),
            );
            if (outline.area <= wholeMaxArea) wholeBlobs.push(outline);
        }

        // Clip lattice curves out of whole-blob interiors.
        const clippedLattice: Curve[] = [];
        for (const curve of lattice) {
            for (const span of clipAgainstBlobs(curve, wholeBlobs, outlineCurves, outlines)) {
                clippedLattice.push(span);
            }
        }

        return [...border, ...outlineCurves, ...clippedLattice];
    },
};

/**
 * Split a lattice curve at its intersections with WHOLE blob outlines
 * and return only the spans whose midpoints are outside every whole
 * blob. Cuts are made exactly at the intersection parameters; the
 * DCEL's T-junction handling turns the touching endpoints into shared
 * vertices (dcel-junction.test.ts pins this).
 */
function clipAgainstBlobs(
    curve: Curve,
    wholeBlobs: SilhouetteOutline[],
    outlineCurves: Curve[],
    allOutlines: SilhouetteOutline[],
): Curve[] {
    if (wholeBlobs.length === 0) return [curve];

    // Gather split parameters against whole-blob outline curves only.
    const ts: number[] = [];
    for (let i = 0; i < allOutlines.length; i++) {
        if (!wholeBlobs.includes(allOutlines[i])) continue;
        for (const ix of curve.intersect(outlineCurves[i])) {
            if (ix.tSelf > 1e-6 && ix.tSelf < 1 - 1e-6) ts.push(ix.tSelf);
        }
    }
    if (ts.length === 0) {
        return isInsideAnyBlob(curve.pointAt(0.5), wholeBlobs) ? [] : [curve];
    }
    ts.sort((a, b) => a - b);

    // Walk the spans between consecutive cut parameters.
    const bounds = [0, ...ts, 1];
    const spans: Curve[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const t0 = bounds[i], t1 = bounds[i + 1];
        if (t1 - t0 < 1e-6) continue;
        const mid = curve.pointAt((t0 + t1) / 2);
        if (isInsideAnyBlob(mid, wholeBlobs)) continue;
        spans.push(extractSpan(curve, t0, t1));
    }
    return spans;
}

/** Sub-curve for t ∈ [t0, t1] with the usual re-scaling after splitAt. */
function extractSpan(curve: Curve, t0: number, t1: number): Curve {
    let c = curve;
    if (t0 > 1e-9) {
        c = curve.splitAt(t0)[1];
        t1 = (t1 - t0) / (1 - t0);
    }
    if (t1 < 1 - 1e-9) {
        c = c.splitAt(t1)[0];
    }
    return c;
}

function isInsideAnyBlob(p: Point, blobs: SilhouetteOutline[]): boolean {
    return blobs.some(b => pointInPolygon(p, b.polygon));
}

/** Standard even-odd ray cast. */
function pointInPolygon(p: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y)
            && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}
```

Register in `generator-registry.ts`:

```typescript
import { silhouetteCutGenerator } from './silhouette-cut-generator.js';
// ... with the other registrations:
registerBaseCutGenerator(silhouetteCutGenerator);
```

**If Task 1's spike showed T-junctions are NOT handled:** change `clipAgainstBlobs` to over-extend each kept span into the blob — replace the span bounds with `t0 - overshoot` / `t1 + overshoot` where `overshoot = CLIP_OVERSHOOT_PX / curve.arcLength()` and `CLIP_OVERSHOOT_PX = 2`, clamped to [0, 1], skipping the overshoot at t=0/t=1 ends.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/puzzle/topology/silhouette-cut-generator.test.ts && npx vitest run src/puzzle/topology/`
Expected: PASS, including no regressions in existing topology tests.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/silhouette-cut-generator.ts src/puzzle/topology/silhouette-cut-generator.test.ts src/puzzle/topology/generator-registry.ts
git commit -m "feat(topology): silhouette base-cut generator"
```

---

### Task 9: Transient outline injection (strategy context + main.ts wiring)

**Files:**
- Modify: `src/game/cut-style-strategies.ts` (`StrategyContext`, `composableStrategy`)
- Modify: `src/game/init.ts` (`InitOptions`, `createNewGame` ctx)
- Modify: `src/main.ts` (`startNewGame` + share-link load path)
- Test: `src/game/cut-style-strategies.test.ts` (extend existing, or create following the test-next-to-source rule)

**Interfaces:**
- Consumes: `computeSilhouetteOutlines` (Task 7), `SilhouetteOutline` (Task 3).
- Produces: `StrategyContext.silhouetteOutlines?: SilhouetteOutline[]`; `InitOptions.silhouetteOutlines?: SilhouetteOutline[]`. The composable strategy merges them into the generator's transient config — mirroring the existing `tabDebug` pattern — so `GameState.composableConfig` never sees them.

- [ ] **Step 1: Write failing test**

Append to (or create) `src/game/cut-style-strategies.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import type { SilhouetteOutline } from '../puzzle/silhouette/types.js';

describe('composable strategy silhouette outline injection', () => {
    const outline: SilhouetteOutline = {
        path: [
            { x: 180, y: 130 },
            { x: 193, y: 130 }, { x: 207, y: 130 }, { x: 220, y: 130 },
            { x: 220, y: 143 }, { x: 220, y: 157 }, { x: 220, y: 170 },
            { x: 207, y: 170 }, { x: 193, y: 170 }, { x: 180, y: 170 },
            { x: 180, y: 157 }, { x: 180, y: 143 }, { x: 180, y: 130 },
        ],
        polygon: [
            { x: 180, y: 130 }, { x: 220, y: 130 },
            { x: 220, y: 170 }, { x: 180, y: 170 },
        ],
        area: 1600,
    };

    it('threads ctx.silhouetteOutlines into generation without touching the config', () => {
        const strategy = getCutStyleStrategy('composable');
        const composableConfig = {
            baseCutGenerator: 'silhouette',
            baseCutConfig: { ha: 0.1, hf: 1, va: 0.1, vf: 1 },
            tabGenerator: 'none' as const,
            tabConfig: {},
        };
        const ctx = { composableConfig, silhouetteOutlines: [outline] };
        const { pieces } = strategy.generatePieces(
            { cols: 4, rows: 3 }, { width: 400, height: 300 }, 42, ctx,
        );
        // The whole blob became a real piece: some piece area ≈ 1600 and
        // more pieces exist than the plain 4×3 lattice would produce.
        expect(pieces.length).toBeGreaterThan(12);
        // The persisted config object was not mutated.
        expect('outlines' in composableConfig.baseCutConfig).toBe(false);
    });

    it('generates a plain lattice when no outlines are provided', () => {
        const strategy = getCutStyleStrategy('composable');
        const { pieces } = strategy.generatePieces(
            { cols: 4, rows: 3 }, { width: 400, height: 300 }, 42,
            {
                composableConfig: {
                    baseCutGenerator: 'silhouette',
                    baseCutConfig: {},
                    tabGenerator: 'none',
                    tabConfig: {},
                },
            },
        );
        expect(pieces.length).toBe(12);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/game/cut-style-strategies.test.ts`
Expected: FAIL — `silhouetteOutlines` not accepted / outlines not threaded (piece count 12 in the first test).

- [ ] **Step 3: Implement the plumbing**

`cut-style-strategies.ts` — extend `StrategyContext`:

```typescript
import type { SilhouetteOutline } from '../puzzle/silhouette/types.js';

export interface StrategyContext {
    fractalConfig?: FractalConfig;
    composableConfig?: ComposableConfig;
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    tabDebug?: TabDebugSession;
    /**
     * Runtime-computed silhouette outlines (composable style with the
     * 'silhouette' base cut only). Injected transiently into the
     * generator config at generation time — the same pattern as
     * `tabDebug` — and NEVER stored on GameState.composableConfig,
     * which is what saves and share links serialize (see the design
     * spec's persistence boundary).
     */
    silhouetteOutlines?: SilhouetteOutline[];
}
```

Rework `composableStrategy.generatePieces`:

```typescript
const composableStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) => {
        let config = ctx.composableConfig;
        if (ctx.silhouetteOutlines !== undefined
            && config?.baseCutGenerator === 'silhouette') {
            config = {
                ...config,
                baseCutConfig: {
                    ...config.baseCutConfig,
                    outlines: ctx.silhouetteOutlines,
                },
            };
        }
        if (ctx.tabDebug) {
            config = { ...config, tabDebug: ctx.tabDebug };
        }
        return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, config);
    },
    configKey: 'composableConfig',
};
```

`init.ts` — extend `InitOptions` and the ctx:

```typescript
    /** Runtime silhouette outlines; see StrategyContext.silhouetteOutlines. */
    silhouetteOutlines?: import('../puzzle/silhouette/types.js').SilhouetteOutline[];
```

```typescript
    const ctx = {
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
        wavyConfig: options.wavyConfig,
        tabDebug,
        silhouetteOutlines: options.silhouetteOutlines,
    };
```

(`createNewGame`'s return already stores `options.composableConfig` untouched — no change needed there; the transient merge happens inside the strategy.)

`main.ts` — in `startNewGame`, after the image URL/size are final (after the Unsplash resolve block, next to the traced-tabs preload pattern) and before `createNewGame`:

```typescript
        // Silhouette base cut: trace the image before generation (async,
        // pre-generation — the composable strategy injects the outlines
        // transiently; they are never persisted). Degrades to [] on any
        // failure, which produces a plain sine lattice.
        let silhouetteOutlines:
            import('./puzzle/silhouette/types.js').SilhouetteOutline[] | undefined;
        if (cutStyle === 'composable'
            && composableConfig?.baseCutGenerator === 'silhouette') {
            silhouetteOutlines = await computeSilhouetteOutlines(
                imageUrl, imageSize, composableConfig.baseCutConfig,
            );
        }
```

…and pass `silhouetteOutlines` in the `createNewGame` options object. Add the import at the top of main.ts:

```typescript
import { computeSilhouetteOutlines } from './puzzle/silhouette/compute-outlines.js';
```

Share-link load path (around main.ts:1293) — same guard before its `createNewGame` call:

```typescript
        let silhouetteOutlines:
            import('./puzzle/silhouette/types.js').SilhouetteOutline[] | undefined;
        if (payload.c === 'composable' && payload.cf?.bg === 'silhouette') {
            silhouetteOutlines = await computeSilhouetteOutlines(
                imageUrl,
                { width: payload.is[0], height: payload.is[1] },
                payload.cf.bgc,
            );
        }
```

…passed into that `createNewGame` call's options. Check how `imageUrl` is named in that scope (read the surrounding lines) and match it.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/game/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/ src/main.ts
git commit -m "feat(game): transient silhouette outline injection for composable"
```

---

### Task 10: Dev UI — dialog controls, config mapping, preference migration

**Files:**
- Modify: `src/game/composable-config.ts` (`ComposableBaseCut`, preference parse, `composableSliderToGeneratorConfig`)
- Modify: `src/ui/new-game-dialog.ts` (`ComposableSliderConfig`, base-cut segmented row, silhouette controls, disclaimer)
- Test: `src/game/composable-config.test.ts` (extend existing if present, else create)

**Interfaces:**
- Consumes: compact bgc keys from Task 7 (`cl`, `mr`, `mnf`, `mxf`, `aa`, `st`, `sm`) + `wp` from Task 8; sine keys `ha/hf/va/vf`.
- Produces: `ComposableSliderConfig`/`ComposableSliderPreference` gain `baseCut: 'sine' | 'triangular' | 'silhouette'` plus fields `silhouetteColorLevels`, `silhouetteMaxRegions`, `silhouetteMinRegionPct` (0–100 UI %), `silhouetteMaxRegionPct`, `silhouetteAllowAdjacent`, `silhouetteWholePieceFactor`, `silhouetteSimplifyTolerance`, `silhouetteSmoothing`. `composableSliderToGeneratorConfig` emits the compact bgc for `baseCut === 'silhouette'`.

- [ ] **Step 1: Write failing tests for the config mapping**

```typescript
import { describe, it, expect } from 'vitest';
import { composableSliderToGeneratorConfig } from './composable-config.js';

const base = {
    horizontalAmplitude: 0.1, horizontalFrequency: 2,
    verticalAmplitude: 0.15, verticalFrequency: 1.5,
    tabGenerator: 'classic' as const, borderless: false,
    jitter: 0.15, smooth: false,
    silhouetteColorLevels: 8, silhouetteMaxRegions: 5,
    silhouetteMinRegionPct: 1, silhouetteMaxRegionPct: 25,
    silhouetteAllowAdjacent: false, silhouetteWholePieceFactor: 3,
    silhouetteSimplifyTolerance: 4, silhouetteSmoothing: 0.8,
};

describe('composableSliderToGeneratorConfig (silhouette)', () => {
    it('emits the compact silhouette bgc including the sine sliders', () => {
        const config = composableSliderToGeneratorConfig({ ...base, baseCut: 'silhouette' });
        expect(config.baseCutGenerator).toBe('silhouette');
        expect(config.baseCutConfig).toEqual({
            ha: 0.1, hf: 2, va: 0.15, vf: 1.5,
            cl: 8, mr: 5, mnf: 0.01, mxf: 0.25,
            aa: false, st: 4, sm: 0.8, wp: 3,
        });
        expect(config.borderless).toBe(false); // silhouette never borderless (v1)
    });

    it('still emits the plain sine shape for baseCut sine', () => {
        const config = composableSliderToGeneratorConfig({ ...base, baseCut: 'sine' });
        expect(config.baseCutGenerator).toBe('sine');
        expect(config.baseCutConfig).toEqual({ ha: 0.1, hf: 2, va: 0.15, vf: 1.5 });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/game/composable-config.test.ts`
Expected: FAIL — silhouette fields unknown / no silhouette branch.

- [ ] **Step 3: Implement `composable-config.ts` changes**

```typescript
export type ComposableBaseCut = 'sine' | 'triangular' | 'silhouette';
```

Extend `ComposableSliderPreference` with the eight `silhouette*` fields (types as in the Interfaces block above). In `parseComposableConfig`, accept `'silhouette'` in the `baseCut` narrowing and default the new fields when missing (stale localStorage from before this PR):

```typescript
    const baseCut: ComposableBaseCut =
        config.baseCut === 'triangular' ? 'triangular'
        : config.baseCut === 'silhouette' ? 'silhouette'
        : DEFAULT_BASE_CUT;
```

```typescript
    const numOr = (v: unknown, fallback: number): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    // Silhouette sliders (defaults mirror DEFAULT_SILHOUETTE_PARAMS,
    // expressed in UI units — pct instead of frac).
    const silhouette = {
        silhouetteColorLevels: numOr(config.silhouetteColorLevels, 8),
        silhouetteMaxRegions: numOr(config.silhouetteMaxRegions, 5),
        silhouetteMinRegionPct: numOr(config.silhouetteMinRegionPct, 1),
        silhouetteMaxRegionPct: numOr(config.silhouetteMaxRegionPct, 25),
        silhouetteAllowAdjacent: config.silhouetteAllowAdjacent === true,
        silhouetteWholePieceFactor: numOr(config.silhouetteWholePieceFactor, 3),
        silhouetteSimplifyTolerance: numOr(config.silhouetteSimplifyTolerance, 4),
        silhouetteSmoothing: numOr(config.silhouetteSmoothing, 0.8),
    };
```

…spread `...silhouette` into the returned object. In `composableSliderToGeneratorConfig`, add the branch BEFORE the sine fallthrough:

```typescript
    if (slider.baseCut === 'silhouette') {
        return {
            baseCutGenerator: 'silhouette',
            baseCutConfig: {
                ha: slider.horizontalAmplitude,
                hf: slider.horizontalFrequency,
                va: slider.verticalAmplitude,
                vf: slider.verticalFrequency,
                cl: slider.silhouetteColorLevels,
                mr: slider.silhouetteMaxRegions,
                mnf: slider.silhouetteMinRegionPct / 100,
                mxf: slider.silhouetteMaxRegionPct / 100,
                aa: slider.silhouetteAllowAdjacent,
                st: slider.silhouetteSimplifyTolerance,
                sm: slider.silhouetteSmoothing,
                wp: slider.silhouetteWholePieceFactor,
            },
            tabGenerator: slider.tabGenerator,
            tabConfig: {},
            borderless: false,
        };
    }
```

- [ ] **Step 4: Implement the dialog changes**

In `new-game-dialog.ts`, following the triangular pattern exactly (`src/ui/new-game-dialog.ts:320-480` — read it before editing):

1. Extend `ComposableSliderConfig` with `baseCut: 'sine' | 'triangular' | 'silhouette'` and the eight `silhouette*` fields.
2. Add `{ value: 'silhouette', label: 'Silhouette' }` to the base-cut segmented row.
3. Create a `silhouetteControls` wrapper div (`dataset.testid = 'composable-silhouette-controls'`) holding sliders (same row builder the sine sliders use):
   - Color levels: min 2, max 16, step 1, default 8
   - Max regions: min 0, max 12, step 1, default 5
   - Min region %: min 0.2, max 10, step 0.2, default 1
   - Max region %: min 5, max 60, step 1, default 25
   - Whole-piece ×: min 1, max 8, step 0.5, default 3
   - Detail (simplify px): min 2, max 16, step 1, default 4
   - Smoothing: min 0, max 1, step 0.1, default 0.8
   - Allow adjacent: checkbox, default off
4. `applyBaseCutVisibility`: silhouette shows `sineControls` (its lattice reuses them) AND `silhouetteControls`, hides `triangularControls` and the Borderless toggle (silhouette is never borderless in v1).
5. A muted disclaimer paragraph inside `silhouetteControls`:
   `Shared Silhouette puzzles are traced from the image on each device and may not reproduce pixel-identically everywhere.`
6. Include the silhouette fields in the dialog's `getValues()` return (read each input like the existing sliders).
7. Pre-populate from `args.saved` like the other fields.

- [ ] **Step 5: Run tests + typecheck + existing dialog tests**

Run: `npx vitest run src/game/composable-config.test.ts src/ui/ && npx tsc --noEmit`
Expected: PASS. If existing dialog tests construct `ComposableSliderConfig` literals, add the new required fields there.

- [ ] **Step 6: Commit**

```bash
git add src/game/composable-config.ts src/game/composable-config.test.ts src/ui/new-game-dialog.ts
git commit -m "feat(ui): silhouette base-cut option with dev sliders"
```

---

### Task 11: Share-link decode clamps for silhouette

**Files:**
- Modify: `src/sharing/share-link.ts`
- Test: `src/sharing/share-link.test.ts` (extend existing)

**Interfaces:**
- Consumes: the compact bgc keys; the sine caps `MAX_SINE_FREQUENCY` / `MAX_SINE_AMPLITUDE` already in the file.
- Produces: decoded `cf.bgc` for `bg === 'silhouette'` has sine fields capped (same caps as sine) and silhouette fields bounded. Note the runtime `silhouetteParamsFromConfig` (Task 7) already re-clamps on read — this decode clamp exists so a hostile link can't even *store* unbounded values, matching how sine is handled.

- [ ] **Step 1: Write failing tests**

Append to `src/sharing/share-link.test.ts` (mirror the existing clamp tests' encode→decode style):

```typescript
describe('silhouette bgc clamping', () => {
    function payloadWith(bgc: Record<string, unknown>) {
        return {
            v: 1 as const, i: 'blank', is: [400, 300] as [number, number],
            g: [4, 3] as [number, number], c: 'composable' as const,
            s: 1, r: 'none' as const,
            cf: { bg: 'silhouette', bgc, tg: 'none', tgc: {} },
        };
    }

    it('caps sine fields on a silhouette link', () => {
        const decoded = decodePayload(encodePayload(payloadWith({ hf: 1e9, ha: 99 })));
        expect(decoded?.cf?.bgc.hf).toBe(100);   // MAX_SINE_FREQUENCY
        expect(decoded?.cf?.bgc.ha).toBe(0.5);   // MAX_SINE_AMPLITUDE
    });

    it('bounds silhouette-specific fields', () => {
        const decoded = decodePayload(encodePayload(payloadWith({
            cl: 9999, mr: 9999, st: 0.0001, mnf: 50, mxf: -3, sm: 42, wp: 1e9,
        })));
        expect(decoded?.cf?.bgc.cl).toBe(32);
        expect(decoded?.cf?.bgc.mr).toBe(20);
        expect(decoded?.cf?.bgc.st).toBe(2);     // floor — curve-count budget
        expect(decoded?.cf?.bgc.mnf).toBe(1);
        expect(decoded?.cf?.bgc.mxf).toBe(0);
        expect(decoded?.cf?.bgc.sm).toBe(1);
        expect(decoded?.cf?.bgc.wp).toBe(100);
    });

    it('accepts silhouette as a known base-cut id', () => {
        expect(decodePayload(encodePayload(payloadWith({})))).not.toBeNull();
    });
});
```

(The last test passes automatically once Task 8 registered the generator — `isKnownBaseCutId` reads the registry.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: the two clamp tests FAIL (values pass through unclamped); the known-id test may already pass.

- [ ] **Step 3: Implement**

In `share-link.ts`, next to `clampSineConfig`:

```typescript
/**
 * Bounds for a decoded silhouette `bgc`. The silhouette base cut reads
 * the sine fields too (its lattice delegates to the sine generator), so
 * the sine caps apply; the silhouette-specific fields are bounded to the
 * ranges silhouetteParamsFromConfig enforces at runtime (the decode
 * clamp keeps hostile values out of persisted state as well —
 * mirroring how sine links are handled). `st` has a FLOOR, not a cap:
 * a tiny simplify tolerance is the curve-count DoS vector (the
 * O(segments²) DCEL intersection pass).
 */
function clampSilhouetteConfig(cf: NonNullable<SharePayload['cf']>): void {
    if (cf.bg !== 'silhouette') return;
    const capNum = (key: string, lo: number, hi: number): void => {
        const v = cf.bgc[key];
        if (typeof v === 'number') {
            cf.bgc[key] = Math.min(hi, Math.max(lo, v));
        }
    };
    capNum('hf', 0, MAX_SINE_FREQUENCY);
    capNum('vf', 0, MAX_SINE_FREQUENCY);
    capNum('ha', 0, MAX_SINE_AMPLITUDE);
    capNum('va', 0, MAX_SINE_AMPLITUDE);
    capNum('cl', 2, 32);
    capNum('mr', 0, 20);
    capNum('mnf', 0, 1);
    capNum('mxf', 0, 1);
    capNum('st', 2, 64);
    capNum('sm', 0, 1);
    capNum('wp', 0, 100);
}
```

Call it in `decodePayload` right after the `clampSineConfig` call:

```typescript
        if (translated.c === 'composable' && translated.cf) {
            clampSineConfig(translated.cf);
            clampSilhouetteConfig(translated.cf);
        }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(sharing): decode clamps for silhouette base-cut links"
```

---

### Task 12: Full verification + dev smoke + PR

**Files:** none new.

- [ ] **Step 1: Full test suite, typecheck, lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: everything green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Manual smoke in the real app**

Run: `npm run dev`, open the app, and verify via the new-game dialog (composable is dev-only — confirm how dev visibility is toggled in `src/game/cut-styles.ts` / `isComposableVisible()` and use that path):

1. Composable → base cut "Silhouette" → random photo → new game: puzzle generates; at least one photo yields visible outline-shaped pieces (try a few photos — subjects on contrasting backgrounds work best).
2. A traced whole piece has NO tabs on its outline and snaps into its background hole.
3. Blank image + Silhouette: plain sine lattice, no errors. A uniform image legitimately produces zero regions through the empty selection (silent by design); verify the console shows no *error*.
4. Share link round trip: copy the share link, open in a new tab — same puzzle (same browser ⇒ exact reproduction).
5. Save/reload: reload the tab mid-puzzle — geometry restores from the save without re-tracing (network tab shows no re-segmentation image fetch beyond the normal image load).
6. Sliders: crank max regions and color levels, confirm generation time stays tolerable (a few seconds worst case) — this is the curve-count budget in practice.

Record any surprises as TODO comments or follow-up issues — do NOT silently tune constants without noting it in the PR description.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/silhouette-cut-generator
gh pr create --title "feat(composable): silhouette base-cut generator" \
  --body "Dev-only composable base cut that traces salient color regions in the image as knife-edge outline pieces and fills the rest with the sine lattice. Spec: docs/superpowers/specs/2026-07-05-silhouette-cut-generator-design.md. <spike outcome: T-junction vs overshoot branch> <manual smoke results>"
```

Replace the two `<...>` markers with the actual spike outcome and smoke results before submitting.

---

## Self-Review Notes

- **Spec coverage:** segmentation pipeline (Tasks 3–7), pre-generation stage + persistence boundary (Tasks 7, 9), generator + clipping + whole/subdivided classification (Task 8), tab suppression (Task 2), dev UI + sine slider forwarding + disclaimer (Task 10), share-link clamps (Task 11), degradation (Task 7), spike (Task 1), tests throughout, manual smoke (Task 12). Auto-group floor: composable's default `minPieceArea` is `DEFAULT_MIN_PIECE_AREA = 4` px² (a 2×2 sliver), and the selection minimum (`minRegionFrac` floor of 0.2% of frame ≈ hundreds of px² at any real size) sits far above it — no extra guard code needed; documented here so the implementer doesn't hunt for a missing task.
- **Type consistency:** compact keys `cl/mr/mnf/mxf/aa/st/sm` are defined once in Task 7 (`silhouetteParamsFromConfig`) and reused by Tasks 10–11; `wp` is generator-side (Task 8). `SilhouetteOutline { path, polygon, area }` is defined in Task 3 and consumed unchanged in Tasks 7–9.
- **Known judgment calls:** contour walker turn preference and the closed-loop DP anchor choice are implementation details with tests as the contract — if an implementation detail must change to pass the tests, keep the tests' observable behavior (corner sets, area, closure) as the spec.
