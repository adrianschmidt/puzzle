# Triangles Cut Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the triangular base cut generator as a production cut style named "Triangles" (fixed config: jitter 0.5, flowing edges, traced tabs), with aspect-adaptive piece counts, `~N` size-button labels, free-rotation-only rotation, share-link/save round-trip, and a wrapping cut-style picker.

**Architecture:** Follows the Wavy preset pattern exactly: a new `CutStyle` union member + `CUT_STYLE_OPTIONS` entry, a strategy in `cut-style-strategies.ts` that calls `generateComposablePuzzle` with a fixed config, a `GameState.trianglesConfig` block pinning the trace-set version, and a `tf` share-link payload field. The one novel piece is aspect-adaptive sizing: the triangular generator takes only `rows` from the grid (columns derive from frame aspect), so the strategy picks the row count whose estimated triangle count best matches the size button's target.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom). Tests live next to the source they test.

**Spec:** `docs/superpowers/specs/2026-07-06-triangles-cut-style-design.md`

## Global Constraints

- Cut style id is `'triangles'`, label `Triangles`, listed **after** `wavy`, **before** `composable`, visible in prod (no dev gate).
- Fixed generation config: `baseCutGenerator: 'triangular'`, `baseCutConfig: { jitter: 0.5, smooth: true }`, `tabGenerator: 'traced'`, **no** `minPieceArea`, no borderless.
- Reproducibility: no new outer-PRNG calls anywhere (the triangular generator draws exactly one; the strategy must not add any). Never touch existing generators' call counts.
- Rotation for Triangles: the top-level "Enable rotation" toggle maps directly to `rotationMode: 'free'`; the free-rotation sub-checkbox stays hidden (it already is — its visibility condition lists only wavy/composable).
- Size buttons for Triangles show `~N` + "pieces" and omit the `cols × rows` line (same rendering branch as Fractal).
- American English in all code/identifiers/comments.
- Run tests with `npm test` (vitest run). Type-check via `npx tsc --noEmit` (fast) or `npm run build` (full).
- Commit after each task; conventional-commit messages; end commit messages with the Co-Authored-By/Claude-Session trailer configured for this session.

---

### Task 0: Branch setup

**Files:** none (git only)

The spec commit (`docs(specs): design for Triangles cut style release`) and the plan commit are on local `main`, ahead of `origin/main`. Move them to a feature branch and restore `main`.

- [ ] **Step 1: Create the feature branch and reset main**

```bash
cd /Users/bot/src/puzzle
git checkout -b feat/triangles-cut-style
git branch -f main origin/main
git log --oneline origin/main..HEAD   # expect: the spec (and plan) docs commits
```

- [ ] **Step 2: Commit the plan document (if not yet committed)**

```bash
git add docs/superpowers/plans/2026-07-06-triangles-cut-style.md
git commit -m "docs(plans): implementation plan for Triangles cut style"
```

---

### Task 1: Face-count estimator in the triangular generator

**Files:**
- Modify: `src/puzzle/topology/triangular-cut-generator.ts` (export `MAX_ROWS`, add `estimateTriangleFaceCount`)
- Test: `src/puzzle/topology/triangular-cut-generator.test.ts` (append a describe block)

**Interfaces:**
- Produces: `export const MAX_ROWS = 16` (currently module-private; same name, now exported) and `export function estimateTriangleFaceCount(rows: number, frame: Size): number`. Task 2 imports both.

The estimator lives in the generator module — next to the column-snapping code it mirrors — so the estimate and the lattice cannot drift apart silently.

Face-count derivation (verify against the test, not just trust): the snapped lattice produces, per horizontal strip, `2·cols` full triangles plus 2 border half-triangles, i.e. `2·cols + 1` faces per strip; total `rows · (2·cols + 1)`. Jitter never moves nodes across edges (inset) and smoothing at jitter 0 is exact lines, so the count is exact for `jitter: 0, smooth: false` and approximate under the production preset.

- [ ] **Step 1: Write the failing tests**

Append to `src/puzzle/topology/triangular-cut-generator.test.ts` (match the file's existing import style):

```ts
import { estimateTriangleFaceCount } from './triangular-cut-generator.js';
import { generateComposablePuzzle } from '../composable-generator.js';

describe('estimateTriangleFaceCount', () => {
    it('computes the strip formula for known cases', () => {
        // 400×400, rows 2: side = 2·200/√3 ≈ 230.9, cols = round(400/230.9) = 2
        expect(estimateTriangleFaceCount(2, { width: 400, height: 400 })).toBe(2 * (2 * 2 + 1));
        // 1080×720, rows 3: side ≈ 277.1, cols = round(1080/277.1) = 4
        expect(estimateTriangleFaceCount(3, { width: 1080, height: 720 })).toBe(3 * (2 * 4 + 1));
        // 720×1080, rows 4: side ≈ 311.8, cols = round(720/311.8) = 2
        expect(estimateTriangleFaceCount(4, { width: 720, height: 1080 })).toBe(4 * (2 * 2 + 1));
    });

    it('matches the exact face count of an unjittered, unsmoothed lattice', () => {
        const cases: Array<[number, { width: number; height: number }]> = [
            [2, { width: 400, height: 400 }],
            [3, { width: 1080, height: 720 }],
            [4, { width: 720, height: 1080 }],
        ];
        for (const [rows, frame] of cases) {
            const { pieces } = generateComposablePuzzle(1, rows, frame, 42, {
                baseCutGenerator: 'triangular',
                baseCutConfig: { jitter: 0, smooth: false },
                tabGenerator: 'none',
            });
            expect(pieces.length).toBe(estimateTriangleFaceCount(rows, frame));
        }
    });

    it('stays close under the production preset (jitter 0.5, smooth)', () => {
        const frame = { width: 1080, height: 720 };
        const estimate = estimateTriangleFaceCount(6, frame);
        const { pieces } = generateComposablePuzzle(1, 6, frame, 7, {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.5, smooth: true },
            tabGenerator: 'none',
        });
        // Jittered+bowed edges can add/drop the odd micro-face; ±15% is plenty
        // for a "~N" label while still catching a broken formula.
        expect(pieces.length).toBeGreaterThan(estimate * 0.85);
        expect(pieces.length).toBeLessThan(estimate * 1.15);
    });
});
```

Note: `tabGenerator: 'none'` avoids the traced lazy-load stub; tab choice never changes face count.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: FAIL — `estimateTriangleFaceCount` is not exported.

- [ ] **Step 3: Implement**

In `src/puzzle/topology/triangular-cut-generator.ts`, change `const MAX_ROWS = 16;` to `export const MAX_ROWS = 16;` (keep its doc comment), and add below it:

```ts
/**
 * Estimate the face (piece) count the lattice produces for a given row count
 * and frame — the sizing input for the Triangles cut style's aspect-adaptive
 * row selection. Mirrors `generate`'s column derivation (equilateral snap +
 * curve-budget clamp) exactly; kept in this module so the two cannot drift.
 *
 * Exact for `jitter: 0, smooth: false` (each strip holds 2·cols full
 * triangles plus two border half-triangles); the production preset's jitter
 * and bowing can add or drop the odd micro-face, which the ~N size labels
 * absorb.
 */
export function estimateTriangleFaceCount(rows: number, frame: Size): number {
    const r = Math.min(MAX_ROWS, Math.max(1, Math.floor(rows)));
    const rowHeight = frame.height / r;
    const equilateralSide = (2 * rowHeight) / Math.sqrt(3);
    const colBudget = Math.max(1, Math.floor(TARGET_MAX_CURVES / (3 * r)));
    const cols = Math.min(colBudget, Math.max(1, Math.round(frame.width / equilateralSide)));
    return r * (2 * cols + 1);
}
```

If the exact-count test disagrees with the formula, the *generated* count is the truth — inspect the mismatch case and fix the formula (do not widen the assertion).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/puzzle/topology/triangular-cut-generator.test.ts`
Expected: PASS (all, including the pre-existing tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/triangular-cut-generator.ts src/puzzle/topology/triangular-cut-generator.test.ts
git commit -m "feat(topology): estimate triangular lattice face count"
```

---

### Task 2: The `triangles` cut style — type, option, strategy, init wiring

**Files:**
- Modify: `src/game/cut-styles.ts:13` (union), `:31-52` (options array)
- Modify: `src/model/types.ts:197-213` (add `trianglesConfig` after `wavyConfig`)
- Modify: `src/game/cut-style-strategies.ts` (context, configKey union, `selectTriangleRows`, `trianglesStrategy`, STRATEGIES)
- Modify: `src/game/init.ts:44-65` (InitOptions), `:89-94` (ctx), `:127-130` (state fields)
- Test: `src/game/cut-styles.test.ts`, `src/game/cut-style-strategies.test.ts`, new `src/game/cut-style-strategies.triangles-traced.test.ts`

**Interfaces:**
- Consumes: `estimateTriangleFaceCount`, `MAX_ROWS` from Task 1.
- Produces: `CutStyle` includes `'triangles'`; `GameState.trianglesConfig?: { traceSetVersion?: number }`; `StrategyContext.trianglesConfig?: { traceSetVersion?: number }`; `InitOptions.trianglesConfig` (same shape); `export function selectTriangleRows(targetPieceCount: number, imageSize: Size): number` in cut-style-strategies.ts. Tasks 3–6 rely on all of these names.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/cut-styles.test.ts` (mirror the existing wavy-position test at line 33 and the prod-visibility stubs at lines 97-115):

```ts
it('includes triangles between wavy and composable', () => {
    const ids = CUT_STYLE_OPTIONS.map((o) => o.id);
    expect(ids.indexOf('triangles')).toBeGreaterThan(ids.indexOf('wavy'));
    expect(ids.indexOf('composable')).toBeGreaterThan(ids.indexOf('triangles'));
});

it('shows triangles on production builds', () => {
    // Inside the existing `getVisibleCutStyleOptions` describe (it owns the
    // vi.unstubAllEnvs() afterEach).
    vi.stubEnv('DEV', false);
    vi.stubEnv('BASE_URL', '/puzzle/');
    const ids = getVisibleCutStyleOptions().map((o) => o.id);
    expect(ids).toContain('triangles');
});
```

Append to `src/game/cut-style-strategies.test.ts`:

```ts
import { selectTriangleRows, getCutStyleStrategy } from './cut-style-strategies.js';

describe('selectTriangleRows', () => {
    const landscape = { width: 1080, height: 720 };

    it('maps the standard size targets on a 3:2 landscape', () => {
        expect(selectTriangleRows(24, landscape)).toBe(3);   // est 27
        expect(selectTriangleRows(48, landscape)).toBe(4);   // est 44
        expect(selectTriangleRows(96, landscape)).toBe(6);   // est 102
        expect(selectTriangleRows(192, landscape)).toBe(8);  // est 168
    });

    it('uses more rows on portrait images for the same target', () => {
        expect(selectTriangleRows(192, { width: 720, height: 1080 }))
            .toBeGreaterThan(selectTriangleRows(192, landscape));
    });

    it('respects the generator row cap on extreme portraits', () => {
        expect(selectTriangleRows(192, { width: 200, height: 1080 }))
            .toBeLessThanOrEqual(16);
    });
});

describe('triangles strategy grid mapping', () => {
    it('scaleGrid keeps user cols and derives triangle rows from the aspect', () => {
        const s = getCutStyleStrategy('triangles');
        expect(s.scaleGrid({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, {}))
            .toEqual({ cols: 6, rows: 3 });
    });

    it('inscribePuzzleSize is the identity', () => {
        const s = getCutStyleStrategy('triangles');
        const size = { width: 1080, height: 720 };
        expect(s.inscribePuzzleSize(size, { cols: 6, rows: 3 }, {})).toEqual(size);
    });
});
```

Create `src/game/cut-style-strategies.triangles-traced.test.ts` (mirrors `cut-style-strategies.wavy-traced.test.ts` — passthrough mock + eager traced registration; see that file's header comments for why):

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Passthrough mock so we can inspect the config the triangles strategy builds
// while still running real generation. See reference_vitest_spy_internal_module_call.
vi.mock('../puzzle/composable-generator.js', async (importActual) => {
    const actual = await importActual<typeof import('../puzzle/composable-generator.js')>();
    return { ...actual, generateComposablePuzzle: vi.fn(actual.generateComposablePuzzle) };
});

import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { createNewGame } from './init.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously in tests (otherwise the stub throws "not loaded").
beforeAll(() => {
    registerTabGenerator(tracedTabGenerator);
});

const size = { width: 1080, height: 720 };

describe('triangles strategy generation', () => {
    it('builds the fixed production config (jitter 0.5, smooth, traced, no minPieceArea)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('triangles').generatePieces({ cols: 6, rows: 3 }, size, 12345, {
            trianglesConfig: { traceSetVersion: 1 },
        });
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            6, 3, size, 12345,
            expect.objectContaining({
                baseCutGenerator: 'triangular',
                baseCutConfig: { jitter: 0.5, smooth: true },
                tabGenerator: 'traced',
                tabConfig: { traceSetVersion: 1 },
            }),
        );
        const cfg = vi.mocked(generateComposablePuzzle).mock.calls[0][4]!;
        expect('minPieceArea' in cfg).toBe(false);
        expect(cfg.borderless ?? false).toBe(false);
    });

    it('defaults the trace-set version when the config lost it (crafted link)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('triangles').generatePieces({ cols: 6, rows: 3 }, size, 12345, {});
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            6, 3, size, 12345,
            expect.objectContaining({ tabGenerator: 'traced', tabConfig: { traceSetVersion: 1 } }),
        );
    });

    it('is deterministic for the same seed', () => {
        const s = getCutStyleStrategy('triangles');
        const ctx = { trianglesConfig: { traceSetVersion: 1 } };
        const a = s.generatePieces({ cols: 6, rows: 3 }, size, 999, ctx);
        const b = s.generatePieces({ cols: 6, rows: 3 }, size, 999, ctx);
        expect(b.pieces.map((p) => p.shape)).toEqual(a.pieces.map((p) => p.shape));
    });

    it('piece count lands near the size target', () => {
        const s = getCutStyleStrategy('triangles');
        const grid = s.scaleGrid({ cols: 8, rows: 6 }, size, {});
        const { pieces } = s.generatePieces(grid, size, 7, { trianglesConfig: { traceSetVersion: 1 } });
        expect(pieces.length).toBeGreaterThan(48 * 0.7);
        expect(pieces.length).toBeLessThan(48 * 1.4);
    });

    it('createNewGame stores trianglesConfig and keeps the user-facing grid', () => {
        const state = createNewGame('img', size, { width: 800, height: 600 }, { cols: 6, rows: 4 }, {
            cutStyle: 'triangles',
            trianglesConfig: { traceSetVersion: 1 },
            seed: 1,
        });
        expect(state.trianglesConfig).toEqual({ traceSetVersion: 1 });
        expect(state.cutStyle).toBe('triangles');
        expect(state.gridSize).toEqual({ cols: 6, rows: 4 }); // user grid, not the scaled one
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/game/cut-styles.test.ts src/game/cut-style-strategies.test.ts src/game/cut-style-strategies.triangles-traced.test.ts`
Expected: FAIL — compile errors (`'triangles'` not in `CutStyle`, `selectTriangleRows` not exported).

- [ ] **Step 3: Implement**

`src/game/cut-styles.ts` — extend the union and the options array (LEGACY_ORDER untouched):

```ts
export type CutStyle = 'classic' | 'fractal' | 'wavy' | 'triangles' | 'composable';
```

Insert between the wavy and composable entries in `CUT_STYLE_OPTIONS`:

```ts
    {
        id: 'triangles',
        label: 'Triangles',
        description: 'An irregular lattice of triangles',
    },
```

`src/model/types.ts` — after the `wavyConfig` field (line ~212):

```ts
    /**
     * Triangles-cut config (only set when cutStyle === 'triangles').
     *
     * Needed to reproduce the puzzle from its seed and surfaced in the
     * Debug panel. The cut parameters themselves (jitter, smoothing,
     * traced tabs) are fixed by the preset; only the trace-set version
     * varies. Mirrors {@link GameState.wavyConfig}.
     */
    trianglesConfig?: {
        /**
         * Trace-set version for the hand-traced tab shapes. Stamped with
         * the current version on every new Triangles game; pins the tab
         * library snapshot so future trace-set releases don't change
         * existing puzzles. See project_share_link_prng_contract.
         */
        traceSetVersion?: number;
    };
```

`src/game/cut-style-strategies.ts`:

1. Imports:

```ts
import {
    estimateTriangleFaceCount,
    MAX_ROWS as MAX_TRIANGLE_ROWS,
} from '../puzzle/topology/triangular-cut-generator.js';
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';
```

2. `StrategyContext` — after `wavyConfig`:

```ts
    trianglesConfig?: { traceSetVersion?: number };
```

3. `configKey` union:

```ts
    configKey?: 'fractalConfig' | 'composableConfig' | 'wavyConfig' | 'trianglesConfig';
```

4. Row selection helper (exported, placed above the strategies):

```ts
/**
 * Pick the triangle row count whose estimated piece count lands closest to
 * the requested target for this image's shape. The triangular lattice takes
 * only `rows` from the grid — its column count derives from the frame aspect
 * ratio — so the same target needs more rows on portrait images than on
 * landscapes. Bounded by the generator's MAX_ROWS; extreme portraits
 * (aspect ≲ 1:3 at the largest size) therefore undershoot the target, which
 * the size buttons' approximate ~N labels absorb.
 */
export function selectTriangleRows(targetPieceCount: number, imageSize: Size): number {
    let best = 1;
    let bestDelta = Infinity;
    for (let rows = 1; rows <= MAX_TRIANGLE_ROWS; rows++) {
        const delta = Math.abs(estimateTriangleFaceCount(rows, imageSize) - targetPieceCount);
        if (delta < bestDelta) {
            best = rows;
            bestDelta = delta;
        }
    }
    return best;
}
```

5. Strategy (after `wavyStrategy`):

```ts
const trianglesStrategy: CutStyleStrategy = {
    // The generator ignores `cols` (it derives columns from the aspect);
    // pass the user grid's cols through so the generation grid stays
    // well-formed for the shared plumbing.
    scaleGrid: (userGrid, imageSize) => ({
        cols: userGrid.cols,
        rows: selectTriangleRows(userGrid.cols * userGrid.rows, imageSize),
    }),
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) =>
        // Fixed production preset: max irregularity with flowing edges and
        // hand-traced tabs. No minPieceArea — the lattice's snapped columns
        // leave clean border half-triangles, not slivers (matches the
        // dev-tested composable-triangular path). The trace-set version
        // falls back to the current one only for payloads that lost their
        // config block (crafted links); every real game/link carries it.
        generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.5, smooth: true },
            tabGenerator: 'traced',
            tabConfig: {
                traceSetVersion:
                    ctx.trianglesConfig?.traceSetVersion ?? CURRENT_TRACE_SET_VERSION,
            },
            tabDebug: ctx.tabDebug,
        }),
    configKey: 'trianglesConfig',
};
```

6. Register: add `triangles: trianglesStrategy,` to `STRATEGIES` (between `wavy` and nothing in particular — key order is cosmetic, match the option order).

`src/game/init.ts`:

- `InitOptions`, after `wavyConfig` (line ~56):

```ts
    /** Configuration for the triangles preset (only used when cutStyle is 'triangles'). */
    trianglesConfig?: { traceSetVersion?: number };
```

- `ctx` construction (line ~89): add `trianglesConfig: options.trianglesConfig,`
- Returned state (line ~129): add after the `wavyConfig` line:

```ts
        trianglesConfig: strategy.configKey === 'trianglesConfig' ? options.trianglesConfig : undefined,
```

- [ ] **Step 4: Run the full suite (types ripple project-wide)**

Run: `npm test` and `npx tsc --noEmit`
Expected: PASS. If any pre-existing test hardcodes the option count/order, update it to the contains-style assertions this repo already favors.

- [ ] **Step 5: Commit**

```bash
git add -A src/game src/model
git commit -m "feat(game): add triangles cut style with aspect-adaptive rows"
```

---

### Task 3: Share-link codec — `c: 'triangles'` + `tf` block

**Files:**
- Modify: `src/sharing/share-link.ts` (payload type :20-62, finite check :70-91, validation :258-272, decode clamp :200-207, encode :388-451)
- Test: `src/sharing/share-link.test.ts`

**Interfaces:**
- Consumes: `GameState.trianglesConfig` (Task 2).
- Produces: `SharePayload['c']` includes `'triangles'`; `SharePayload.tf?: { tv: number }`. Task 5's decode path reads `payload.tf`.

- [ ] **Step 1: Write the failing tests**

Append to `src/sharing/share-link.test.ts`, mirroring the `share-link wavy traceSetVersion (wf.tv)` block at line ~1249 (use the file's existing `buildState` and `encodeRaw` helpers):

```ts
describe('share-link triangles traceSetVersion (tf)', () => {
    function trianglesState(traceSetVersion?: number): GameState {
        return buildState({
            cutStyle: 'triangles',
            trianglesConfig: traceSetVersion === undefined ? {} : { traceSetVersion },
        });
    }

    it('encodes tf.tv from the triangles config', () => {
        const payload = gameStateToPayload(trianglesState(1), { includeProgress: false });
        expect(payload.c).toBe('triangles');
        expect(payload.tf).toEqual({ tv: 1 });
    });

    it('omits tf when the config carries no version', () => {
        const payload = gameStateToPayload(trianglesState(undefined), { includeProgress: false });
        expect(payload.tf).toBeUndefined();
    });

    it('round-trips tf.tv through encode/decode', () => {
        const payload = gameStateToPayload(trianglesState(1), { includeProgress: false });
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded!.c).toBe('triangles');
        expect(decoded!.tf).toEqual({ tv: 1 });
    });

    it('accepts a triangles payload without tf', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'triangles', s: 1, r: 'none',
        }));
        expect(decoded).not.toBeNull();
        expect(decoded!.tf).toBeUndefined();
    });

    it('clamps a future tv down to the newest known version', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'triangles', s: 1, r: 'none',
            tf: { tv: 999 },
        }));
        expect(decoded!.tf!.tv).toBe(CURRENT_TRACE_SET_VERSION);
    });

    it('drops the tf block entirely on an invalid tv', () => {
        for (const bad of [0, -3, 'x', null] as unknown[]) {
            const decoded = decodePayload(encodeRaw({
                v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'triangles', s: 1, r: 'none',
                tf: { tv: bad },
            }));
            expect(decoded).not.toBeNull();
            expect(decoded!.tf).toBeUndefined();
        }
    });

    it('round-trips a triangles payload with free rotation', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'triangles', s: 7, r: 'free',
            tf: { tv: 1 },
        }));
        expect(decoded!.r).toBe('free');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/sharing/share-link.test.ts`
Expected: FAIL — compile error on `c: 'triangles'` / `tf`.

- [ ] **Step 3: Implement**

In `src/sharing/share-link.ts`:

1. Payload type — extend `c` and add `tf` after `wf` (line ~55):

```ts
    /** Cut style. */
    c: 'classic' | 'fractal' | 'composable' | 'wavy' | 'triangles';
    ...
    /**
     * Triangles-cut config. `tv` pins the traced tab-library snapshot.
     * Unlike wavy's `wf.tv`, absence does NOT mean classic tabs — every
     * triangles puzzle uses traced tabs; a missing/invalid block just
     * falls back to the current trace set on the receiver.
     */
    tf?: { tv: number };
```

2. `assertPayloadNumbersFinite` — after the `wf.tv` check (line ~90):

```ts
    if (payload.c === 'triangles' && payload.tf?.tv !== undefined) {
        check(payload.tf.tv, 'tf.tv');
    }
```

3. `isValidPayload` cut-style check (line ~265):

```ts
    if (p.c !== 'classic' && p.c !== 'fractal'
        && p.c !== 'composable' && p.c !== 'wavy' && p.c !== 'triangles') return false;
```

4. `decodePayload` — after the wavy clamp block (line ~207):

```ts
        if (translated.c === 'triangles' && translated.tf) {
            const clamped = clampTraceSetVersion(translated.tf.tv);
            // No legacy-classic fallback here (contrast wf.tv): an invalid tv
            // drops the whole block and the strategy substitutes the current
            // trace set.
            if (clamped === undefined) {
                delete translated.tf;
            } else {
                translated.tf.tv = clamped;
            }
        }
```

5. `gameStateToPayload` — after the wavy block (line ~443):

```ts
    if (cutStyle === 'triangles' && state.trianglesConfig?.traceSetVersion !== undefined) {
        payload.tf = { tv: state.trianglesConfig.traceSetVersion };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(sharing): encode triangles cut style and trace-set pin (tf)"
```

---

### Task 4: Save-state serialization

**Files:**
- Modify: `src/persistence/serialization.ts` (`SerializedGameState` :62-111, `SerializedStaticState` :113-129, `serializeState` :226-238, `serializeStatic` :242-258, `deserializeState` :350-352, `recombine` :413)
- Test: `src/persistence/serialization.test.ts`

**Interfaces:**
- Consumes: `GameState.trianglesConfig` (Task 2).
- Produces: `trianglesConfig` round-trips through both the full and the static/progress split save paths. No `STATE_VERSION` bump — purely additive optional field (older builds ignore it, same reasoning as the `selection` field's comment at serialization.ts:98-110).

- [ ] **Step 1: Write the failing tests**

Append to `src/persistence/serialization.test.ts`, mirroring the wavy round-trip tests at lines 230-255 (use the same state-builder those tests use):

```ts
it('round-trips trianglesConfig through serializeState/deserializeState', () => {
    const state = makeGameState({
        cutStyle: 'triangles',
        trianglesConfig: { traceSetVersion: 1 },
    });
    const restored = deserializeState(serializeState(state));
    expect(restored.trianglesConfig).toEqual({ traceSetVersion: 1 });
});

it('round-trips trianglesConfig through serializeStatic/recombine', () => {
    const state = makeGameState({
        cutStyle: 'triangles',
        trianglesConfig: { traceSetVersion: 1 },
    });
    const restored = recombine(serializeStatic(state), serializeProgress(state));
    expect(restored.trianglesConfig).toEqual({ traceSetVersion: 1 });
});
```

(`makeGameState(overrides)` is the file's existing builder — see the wavy tests at lines 229-255.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/persistence/serialization.test.ts`
Expected: FAIL — `trianglesConfig` dropped on round-trip (and/or compile error on the serialized types).

- [ ] **Step 3: Implement**

Mirror every `wavyConfig` line in `serialization.ts` with a `trianglesConfig` sibling:

- `SerializedGameState`: after `wavyConfig` (line ~90):

```ts
    /**
     * Triangles-cut config (only set when cutStyle === 'triangles').
     */
    trianglesConfig?: GameState['trianglesConfig'];
```

- `SerializedStaticState`: after `wavyConfig` (line ~126): `trianglesConfig?: GameState['trianglesConfig'];`
- `serializeState` (after line ~236): `if (state.trianglesConfig) { serialized.trianglesConfig = state.trianglesConfig; }`
- `serializeStatic` (after line ~256): `if (state.trianglesConfig) s.trianglesConfig = state.trianglesConfig;`
- `deserializeState` (after line ~352): `if (data.trianglesConfig) { state.trianglesConfig = data.trianglesConfig; }`
- `recombine` (after line ~413): `if (staticData.trianglesConfig) state.trianglesConfig = staticData.trianglesConfig;`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/persistence/serialization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat(persistence): round-trip trianglesConfig through saves"
```

---

### Task 5: App wiring — rotation, preload, stamping, shared links, analytics, repro params

**Files:**
- Modify: `src/main.ts` (:906, :944-951, :960-965 area, :970-977, :997-999, :1265-1268, :1293-1304, :1337-1341)
- Modify: `src/ui/info-modal.ts:68-78` (`buildReproParams`)
- Modify: `src/analytics/umami.ts:32-38` (`traceSetVersion` doc comment)

**Interfaces:**
- Consumes: `payload.tf` (Task 3), `InitOptions.trianglesConfig` (Task 2), existing `CURRENT_TRACE_SET_VERSION` import in main.ts.
- Produces: fresh and shared Triangles games generate with traced tabs preloaded, `rotationMode: 'free'` when rotation is enabled, `trianglesConfig` stamped, and `traceSetVersion` analytics.

main.ts has no unit tests; this task is verified by type-check + full suite + the Task 7 in-app verification.

- [ ] **Step 1: startNewGame changes (main.ts)**

Line 906 — include triangles in the traced preload safety net:

```ts
        if (composableConfig?.tabGenerator === 'traced' || cutStyle === 'wavy'
            || cutStyle === 'triangles') {
            await preloadTracedTabGenerator();
        }
```

Rotation mapping (lines 944-951) — insert a triangles branch before the free-rotation branch:

```ts
        let rotationMode: 'none' | 'quarter-turn' | 'free';
        if (!rotationEnabled) {
            rotationMode = 'none';
        } else if (cutStyle === 'triangles') {
            // Triangles offers no quarter-turn mode: 90° steps don't match a
            // triangle lattice, so enabling rotation means free rotation.
            rotationMode = 'free';
        } else if (freeRotation && (cutStyle === 'wavy' || cutStyle === 'composable')) {
            rotationMode = 'free';
        } else {
            rotationMode = 'quarter-turn';
        }
```

(Note this deliberately ignores the `freeRotation` parameter for triangles, so a boot-time regeneration from preferences behaves identically to the dialog path.)

After the `generatorWavyConfig` block (line ~965):

```ts
        // Every new Triangles game uses traced tabs at the current trace-set
        // version — same stamping rationale as generatorWavyConfig above.
        const generatorTrianglesConfig = cutStyle === 'triangles'
            ? { traceSetVersion: CURRENT_TRACE_SET_VERSION }
            : undefined;
```

`createNewGame` options (line ~970): add `trianglesConfig: generatorTrianglesConfig,` after the `wavyConfig` line.

Analytics (after line ~999):

```ts
        if (generatorTrianglesConfig) {
            data.traceSetVersion = generatorTrianglesConfig.traceSetVersion;
        }
```

- [ ] **Step 2: loadSharedPuzzle changes (main.ts)**

Preload condition (line ~1265):

```ts
        if (payload.cf?.tg === 'traced'
            || (payload.c === 'wavy' && payload.wf?.tv !== undefined)
            || payload.c === 'triangles') {
            await preloadTracedTabGenerator();
        }
```

`createNewGame` options (line ~1293-1304): after the `wavyConfig` mapping add:

```ts
            trianglesConfig: payload.tf
                ? { traceSetVersion: payload.tf.tv }
                : undefined,
```

Shared analytics (after the `payload.wf?.tv` block at line ~1341):

```ts
        if (payload.c === 'triangles' && payload.tf?.tv !== undefined) {
            data.traceSetVersion = payload.tf.tv;
        }
```

- [ ] **Step 3: Repro params (info-modal.ts) and analytics doc (umami.ts)**

`buildReproParams` (info-modal.ts, after line 76):

```ts
    if (state.trianglesConfig) params.trianglesConfig = state.trianglesConfig;
```

`umami.ts` — update the `traceSetVersion` doc comment (lines ~33-38) so it covers both styles:

```ts
    /**
     * Trace-set version backing a Wavy or Triangles puzzle's tabs. Present
     * for traced-tab Wavy games and all Triangles games (omitted for every
     * other cut style and for legacy classic-tab Wavy links), so analytics
     * can tell traced from legacy Wavy and follow trace-set versions once a
     * v2 ships.
     */
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean type-check, full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/ui/info-modal.ts src/analytics/umami.ts
git commit -m "feat(app): wire triangles style through new-game, share, and analytics"
```

---

### Task 6: New-game dialog — approximate labels and traced preload

**Files:**
- Modify: `src/ui/new-game-dialog.ts` (:52-58 doc, :175-204 `updateLabels`, :716-719 and :730-733 preload conditions)
- Test: `src/ui/new-game-dialog.test.ts`

**Interfaces:**
- Consumes: `'triangles'` in `CUT_STYLE_OPTIONS` (Task 2 — the dialog resets unknown ids to the default, so tests can only select `'triangles'` once the option exists).
- Produces: `~N`-labeled, dimension-free size buttons whenever the triangles style is active; traced preload fires for triangles like it does for wavy.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/new-game-dialog.test.ts` (mirror the fractal label tests around line 152 and the file's preload tests):

```ts
it('shows approximate piece counts without grid dims for triangles', () => {
    createNewGameDialog({
        container,
        selectedSizeId: '48',
        selectedCutStyleId: 'triangles',
        onSelect: vi.fn(),
    });

    const counts = container.querySelectorAll('.size-picker-count');
    expect(counts[0].textContent).toBe('~24');
    expect(counts[1].textContent).toBe('~48');
    expect(counts[2].textContent).toBe('~96');
    expect(counts[3].textContent).toBe('~192');
    expect(container.querySelectorAll('.size-picker-dims')).toHaveLength(0);
});

it('fires onPreloadTracedTabs when opened with triangles selected', () => {
    const onPreloadTracedTabs = vi.fn();
    createNewGameDialog({
        container,
        selectedSizeId: '48',
        selectedCutStyleId: 'triangles',
        onSelect: vi.fn(),
        onPreloadTracedTabs,
    });
    expect(onPreloadTracedTabs).toHaveBeenCalled();
});
```

```ts
it('keeps the free-rotation sub-checkbox hidden for triangles with rotation enabled', () => {
    createNewGameDialog({
        container,
        selectedSizeId: '48',
        selectedCutStyleId: 'triangles',
        savedRotationEnabled: true,
        onSelect: vi.fn(),
    });
    const row = container.querySelector<HTMLElement>('.free-rotation-row')!;
    expect(row.style.display).toBe('none');
});
```

(This locks existing behavior — the visibility condition lists only wavy/composable — so a later refactor can't accidentally surface the sub-checkbox for Triangles.)

If the file already has a "fires onPreloadTracedTabs when switching to wavy" test, add the switching-to-triangles sibling next to it using the same radio-clicking helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/ui/new-game-dialog.test.ts`
Expected: FAIL — counts render `24` (not `~24`), dims present, preload not called.

- [ ] **Step 3: Implement**

`updateLabels` (new-game-dialog.ts:175-204) — generalize the fractal branch:

```ts
    function updateLabels(): void {
        // Fractal and Triangles piece counts are approximate: fractal scales
        // an internal grid, and the triangle lattice derives its column count
        // from the image aspect ratio (unknown until the photo is fetched).
        // Both show ~N and omit the meaningless cols × rows line.
        const cutStyleId = args.getCutStyleId();
        const isApproximate = cutStyleId === 'fractal' || cutStyleId === 'triangles';

        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const opt = PUZZLE_SIZE_OPTIONS[i];

            btn.replaceChildren();

            const count = document.createElement('span');
            count.className = 'size-picker-count';
            count.textContent = isApproximate ? `~${opt.pieceCount}` : String(opt.pieceCount);

            const label = document.createElement('span');
            label.className = 'size-picker-label';
            label.textContent = 'pieces';

            btn.appendChild(count);
            btn.appendChild(label);

            if (!isApproximate) {
                const dims = document.createElement('span');
                dims.className = 'size-picker-dims';
                dims.textContent = `${opt.cols} × ${opt.rows}`;
                btn.appendChild(dims);
            }
        }
    }
```

Preload on cut-style change (line ~716):

```ts
            if (id === 'wavy' || id === 'triangles'
                || (id === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
                options.onPreloadTracedTabs?.();
            }
```

Preload on open (line ~730):

```ts
    if (currentCutStyleId === 'wavy' || currentCutStyleId === 'triangles'
        || (currentCutStyleId === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
        options.onPreloadTracedTabs?.();
    }
```

`NewGameSelection.freeRotation` doc (line ~53-58) — append one sentence so the host mapping is discoverable:

```
     * Triangles is deliberately not included: the host maps its plain
     * rotation toggle straight to free rotation (see startNewGame).
```

No visibility change for the free-rotation sub-checkbox — its condition already lists only wavy/composable, so it stays hidden for triangles.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/new-game-dialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat(ui): approximate size labels and traced preload for triangles"
```

---

### Task 7: Picker wrap layout + info-modal help copy

**Files:**
- Modify: `src/style.css:666-670` (`.cut-style-grid`), `:671-673` (`.cut-style-option`)
- Modify: `src/ui/info-modal.ts` (`buildCutStylesSection` :171-220, rotate bullet in `buildHowToPlaySection` :154-164)
- Test: `src/ui/info-modal.test.ts` (only if existing assertions break — see Step 3)

- [ ] **Step 1: CSS — wrap the cut-style buttons**

Replace `.cut-style-grid` (style.css:666-669):

```css
.cut-style-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
```

Remove the `flex: 1;` line from `.cut-style-option` (:671-673) — meaningless under grid; the cells are equal-width by the template. Keep everything else.

- [ ] **Step 2: Info modal copy**

In `buildCutStylesSection`, after the `list.appendChild(wavyLi);` line (:216), add:

```ts
    appendInlineLi(list, [
        ['strong', 'Triangles'],
        " — An irregular lattice of triangles with flowing cuts and hand-traced tabs. Piece counts adapt to each photo's shape, so they're approximate. Enabling rotation lets pieces rotate freely to any angle.",
    ]);
```

In `buildHowToPlaySection`'s rotate bullet (:160-161), change:

```ts
        ['strong', 'Free rotation'],
        " (Wavy puzzles only), a single round handle below the focused piece lets you drag to rotate continuously — the group follows your finger like a dial. ...
```

to:

```ts
        ['strong', 'Free rotation'],
        " (Wavy and Triangles puzzles), a single round handle below the focused piece lets you drag to rotate continuously — the group follows your finger like a dial. ...
```

(keep the rest of the string verbatim).

- [ ] **Step 3: Run the UI tests**

Run: `npm test -- src/ui/info-modal.test.ts src/ui/cut-style-picker.test.ts`
Expected: PASS — the picker test counts buttons via `CUT_STYLE_OPTIONS.length`, so it self-adjusts. If an info-modal test asserts the old "(Wavy puzzles only)" copy, update it to the new string.

- [ ] **Step 4: Commit**

```bash
git add src/style.css src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "feat(ui): wrap cut-style picker and document triangles in help"
```

---

### Task 8: Full verification and PR

- [ ] **Step 1: Full suite + build**

```bash
npm test && npm run build
```

Expected: all tests pass, clean production build.

- [ ] **Step 2: In-app verification (use the /verify skill or dev server)**

Start `npm run dev` and check, in a real browser:

1. New Game dialog shows **Triangles** after Wavy; with 5 styles (dev includes Composable) the buttons wrap to a second line, equal-width and aligned; tune the CSS `minmax(110px, 1fr)` if 3–4 per row on desktop / 2 on a ~375px viewport doesn't hold.
2. Selecting Triangles flips the size buttons to `~24 / ~48 / ~96 / ~192` with no `cols × rows` line; no sub-options section appears; "Enable rotation" shows no free-rotation sub-checkbox.
3. Starting a ~48 Triangles game produces a triangular puzzle with traced tabs and flowing, irregular cuts; piece count (Debug panel or completion counter) lands near 48 for a landscape photo.
4. With rotation enabled, pieces spawn at arbitrary angles and show the free-rotation drag handle.
5. Info modal → Share this puzzle: copy the link, open it in a new tab → identical puzzle (compare a few piece shapes). Debug panel repro params include `trianglesConfig: { traceSetVersion: 1 }`.
6. Reload mid-game → the save restores.

This is mechanism verification; the aesthetic call (does 0.5-jitter flowing-traced look right at all four sizes) is Adrian's on dev-deploy — flag it in the PR body rather than self-certifying (see feedback_verify_mechanism_vs_quality).

- [ ] **Step 3: Push and open the PR (no confirmation needed — repo norm)**

```bash
git push -u origin feat/triangles-cut-style
gh pr create --title "feat: release Triangles cut style" --body "..."
```

PR body: summarize the preset (triangular base cut, jitter 0.5, flowing edges, traced tabs pinned to trace-set v1), the aspect-adaptive row selection with `~N` labels, rotation-toggle→free mapping, `tf` share-link block, picker wrap CSS, and help-text updates. Note explicitly that visual quality at the four sizes needs Adrian's judgment on dev-deploy. If a GitHub issue exists for this feature, put `Closes #N` as a standalone first line.
