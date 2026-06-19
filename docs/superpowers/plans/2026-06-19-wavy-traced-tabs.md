# Wavy Traced Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new Wavy game use the lazy-loaded traced (hand-photographed) tab shapes, while every existing Wavy share-link and save keeps reproducing exactly as today (classic tabs), and future trace-set revisions stay reproducible via frozen, versioned snapshots.

**Architecture:** A single integer `traceSetVersion` flows from the new-game path → `wavyConfig` → the `traced` tab generator, which resolves it to a frozen ordered trace list (the versioned manifest) and scales its PRNG selection to that list. Absence of the version everywhere means "classic tabs" — so legacy links/saves are untouched. The share-link records the version as an optional `wf.tv`; absent ⇒ classic.

**Tech Stack:** TypeScript, Vite, Vitest. Seeded PRNG (`createSeededRandom`, mulberry32). Lazy `import()` chunk for the traced generator.

## Global Constraints

- **Reproducibility contract:** the number and order of outer-PRNG `random()` calls during generation must not change for legacy puzzles. The traced template already consumes **exactly one outer call** (a sub-PRNG seed); per edge the traced generator consumes **exactly 3 outer calls** (2 placement + 1 template). Do not change these counts. (`project_share_link_prng_contract`)
- **Frozen snapshots:** once shipped, a trace-set version's ordered list is **never edited** (no reorder/removal). New sets ship as a new version entry + a `CURRENT_TRACE_SET_VERSION` bump.
- **Classic = absence:** `traceSetVersion` absent (config, payload, save) ⇒ `tabGenerator: 'classic'`, `tabConfig: {}` — byte-identical to today's Wavy.
- **No `STATE_VERSION` bump:** `traceSetVersion` is an additive optional field on `wavyConfig`, like `viewport`/`selection` (`STATE_VERSION` stays 11).
- **American English** in all identifiers/comments.
- **Tests live next to source** (same directory).
- **Every commit message ends with the trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Commands:** all tests `npx vitest run`; single file `npx vitest run <path>`; typecheck `npx tsc --noEmit`; build `npm run build`.

---

### Task 1: Versioned trace-set manifest + `CURRENT_TRACE_SET_VERSION`

**Files:**
- Create: `src/puzzle/composable/traces/trace-set-version.ts`
- Modify: `src/puzzle/composable/traces/index.ts` (append after `TRACED_TEMPLATES`, ends line 131)
- Test: `src/puzzle/composable/traces/index.test.ts` (append)

**Interfaces:**
- Produces: `CURRENT_TRACE_SET_VERSION: number` (main-chunk constant); `getTracedTemplates(version: number): readonly TracedTemplate[]` (lazy module).

- [ ] **Step 1: Write the failing test** — append to `src/puzzle/composable/traces/index.test.ts`:

```ts
import { getTracedTemplates } from './index.js';
import { CURRENT_TRACE_SET_VERSION } from './trace-set-version.js';

describe('trace-set versioning', () => {
    it('CURRENT_TRACE_SET_VERSION is a positive integer', () => {
        expect(Number.isInteger(CURRENT_TRACE_SET_VERSION)).toBe(true);
        expect(CURRENT_TRACE_SET_VERSION).toBeGreaterThanOrEqual(1);
    });

    it('version 1 resolves to the original ordered library', () => {
        expect(getTracedTemplates(1)).toEqual(TRACED_TEMPLATES);
    });

    it('falls back to v1 for an unknown version', () => {
        expect(getTracedTemplates(999)).toEqual(TRACED_TEMPLATES);
    });
});
```

(`TRACED_TEMPLATES` is already imported at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/composable/traces/index.test.ts`
Expected: FAIL — `getTracedTemplates` / `trace-set-version.js` not found.

- [ ] **Step 3: Create `src/puzzle/composable/traces/trace-set-version.ts`**

```ts
/**
 * Trace-set version (main-chunk constant).
 *
 * The traced tab library is versioned so future revisions (adding, removing,
 * reworking, or reordering traces) don't break the puzzles that existing
 * share-links and saves reproduce. Each released version is a frozen, ordered
 * snapshot resolved by `getTracedTemplates` in the (lazy) traces module; this
 * file holds only the small integer the new-game path and the share-link
 * decoder need, so neither pulls in the heavy trace data.
 *
 * Bump this when you ship a new trace set. Never edit a previously shipped
 * snapshot. See `getTracedTemplates` and project_share_link_prng_contract.
 */
export const CURRENT_TRACE_SET_VERSION = 1;
```

- [ ] **Step 4: Add the manifest to `src/puzzle/composable/traces/index.ts`** (append after the `TRACED_TEMPLATES` array, after line 131):

```ts

/**
 * Version 1 trace set: the original ordered library. FROZEN — never edit this
 * list (no reorders or removals). A new trace set ships as a new entry in
 * TRACE_SETS plus a CURRENT_TRACE_SET_VERSION bump, leaving every older
 * snapshot byte-for-byte intact so old share-links still reproduce.
 */
const TRACE_SET_V1: readonly TracedTemplate[] = TRACED_TEMPLATES;

/** version → frozen ordered template list. */
const TRACE_SETS: Readonly<Record<number, readonly TracedTemplate[]>> = {
    1: TRACE_SET_V1,
};

/**
 * Resolve a trace-set version to its frozen ordered template list. Unknown
 * versions fall back to v1 — a defensive net only; the share-link decoder
 * clamps `wf.tv` to [1, CURRENT_TRACE_SET_VERSION] before generation, so a
 * known client never asks for a version it lacks.
 */
export function getTracedTemplates(version: number): readonly TracedTemplate[] {
    return TRACE_SETS[version] ?? TRACE_SET_V1;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/puzzle/composable/traces/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/composable/traces/trace-set-version.ts src/puzzle/composable/traces/index.ts src/puzzle/composable/traces/index.test.ts
git commit -m "feat(traces): versioned trace-set manifest + CURRENT_TRACE_SET_VERSION"
```

---

### Task 2: Parameterize the traced tab template by trace set

**Files:**
- Modify: `src/puzzle/composable/tab-shapes-traced.ts:82-149` (the `tracedTabTemplate` const)
- Test: `src/puzzle/composable/tab-shapes-traced.test.ts` (append)

**Interfaces:**
- Consumes: `TracedTemplate` (from `./traces/index.js`, already imported).
- Produces: `createTracedTabTemplate(templates: readonly TracedTemplate[]): TabTemplate`. `tracedTabTemplate` remains exported (now `= createTracedTabTemplate(TRACED_TEMPLATES)`), so existing importers (`traced-tab-generator.ts`, this test) keep working.

- [ ] **Step 1: Write the failing test** — append to `src/puzzle/composable/tab-shapes-traced.test.ts`:

```ts
import { createTracedTabTemplate } from './tab-shapes-traced.js';

describe('createTracedTabTemplate', () => {
    it('advances the outer PRNG by exactly one call', () => {
        let calls = 0;
        const counting = (): number => { calls++; return 0.5; };
        createTracedTabTemplate(TRACED_TEMPLATES).generate(counting);
        expect(calls).toBe(1);
    });

    it('selects only from the provided template list', () => {
        // Single-element lists force idx 0, so the only difference between
        // the two outputs is the source template geometry.
        const onlyFirst = createTracedTabTemplate([TRACED_TEMPLATES[0]]);
        const onlySecond = createTracedTabTemplate([TRACED_TEMPLATES[1]]);
        const a = onlyFirst.generate(createSeededRandom(123));
        const b = onlySecond.generate(createSeededRandom(123));
        expect(a).not.toEqual(b);
    });
});
```

(`TRACED_TEMPLATES` and `createSeededRandom` are already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/composable/tab-shapes-traced.test.ts`
Expected: FAIL — `createTracedTabTemplate` is not exported.

- [ ] **Step 3: Refactor `tab-shapes-traced.ts`** — replace the `export const tracedTabTemplate: TabTemplate = { ... };` block (lines 82-149) with a factory plus a v1 default. The `generate` body is unchanged except it indexes the passed `templates` instead of the module-level `TRACED_TEMPLATES`:

```ts
/**
 * Build a traced tab template bound to a specific (frozen) ordered trace
 * list. The trace-set version chooses which list — see getTracedTemplates.
 *
 * Outer-PRNG contract LOCKED: exactly ONE outer call per generation, which
 * seeds a local sub-PRNG that drives every per-edge transform. Changing
 * `templates` changes only which trace is selected and its geometry; it does
 * not change the outer- or local-PRNG call sequence.
 */
export function createTracedTabTemplate(
    templates: readonly TracedTemplate[],
): TabTemplate {
    return {
        name: 'Traced',

        generate(random: () => number): BezierPath {
            const subSeed = random();
            const local = createSeededRandom(seedFromFloat(subSeed));

            const idx       = Math.floor(local() * templates.length); // local 1
            const flip      = local() < 0.5;                          // local 2
            const templateId = templates[idx].id;
            const scalex    = lerp(0.14, 0.20, local());              // local 3
            const scaley    = lerp(0.85, 1.15, local());              // local 4
            const mid       = lerp(0.45, 0.55, local());              // local 5
            const neckScale = lerp(0.75, 1.10, local());              // local 6

            recordTracedTabChoice({
                templateIdx: idx, templateId,
                flip, scalex, scaley, mid, neckScale,
            });

            const template: TracedTemplate = templates[idx];
            let path: Point[] = template.path.map(p => ({ x: p.x, y: p.y }));
            let landmarks = template.landmarks;

            if (flip) {
                path = reverseBezierPath(path.map(p => ({ x: 1 - p.x, y: p.y })));
                landmarks = mirrorLandmarksX(landmarks);
            }

            path = path.map(p => pinchNeck(p, landmarks, neckScale));

            const xFactor = scalex / Math.max(0.05, landmarks.neck.width);
            const yFactor = xFactor * scaley;

            path = path.map(p => ({
                x: mid + (p.x - landmarks.neck.center_x) * xFactor,
                y: p.y * yFactor,
            }));

            return path;
        },
    };
}

/**
 * Default (version 1) traced template. Retained for the TabTemplate surface,
 * the traced-tab-recorder docs, and direct unit tests; production generation
 * resolves the template for the requested trace-set version via the generator
 * (see traced-tab-generator.ts).
 */
export const tracedTabTemplate: TabTemplate = createTracedTabTemplate(TRACED_TEMPLATES);
```

Leave the existing imports and helper functions (`lerp`, `seedFromFloat`, `mirrorLandmarksX`, `neckWeight`, `pivotX`, `pinchNeck`) and the long explanatory comments above them in place — they are still used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/puzzle/composable/tab-shapes-traced.test.ts`
Expected: PASS (new tests + the existing `tracedTabTemplate` tests, which still exercise the v1 default).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/composable/tab-shapes-traced.ts src/puzzle/composable/tab-shapes-traced.test.ts
git commit -m "refactor(traces): factory for trace-set-bound traced tab template"
```

---

### Task 3: Traced generator reads `traceSetVersion` from config

**Files:**
- Modify: `src/puzzle/topology/traced-tab-generator.ts` (whole file)
- Test: `src/puzzle/topology/traced-tab-generator.test.ts` (append)

**Interfaces:**
- Consumes: `createTracedTabTemplate` (Task 2), `getTracedTemplates` (Task 1).
- Produces: `tracedTabGenerator` now reads `config.traceSetVersion` (number); absent/invalid ⇒ 1. Outer-PRNG count per edge unchanged (3).

- [ ] **Step 1: Write the failing test** — append to `src/puzzle/topology/traced-tab-generator.test.ts`:

```ts
describe('tracedTabGenerator trace-set version', () => {
    it('version 1 reproduces the same tab as an un-versioned config', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const a = tracedTabGenerator.generate(edge, createSeededRandom(55), {});
        const b = tracedTabGenerator.generate(edge, createSeededRandom(55), { traceSetVersion: 1 });
        expect(a).not.toBeNull();
        expect(b!.segments).toEqual(a!.segments);
    });

    it('an unknown version falls back to v1 output', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const v1 = tracedTabGenerator.generate(edge, createSeededRandom(77), { traceSetVersion: 1 });
        const future = tracedTabGenerator.generate(edge, createSeededRandom(77), { traceSetVersion: 999 });
        expect(future!.segments).toEqual(v1!.segments);
    });

    it('still consumes exactly 3 outer PRNG calls with a version set', () => {
        let calls = 0;
        const counting = (): number => { calls++; return 0.5; };
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        tracedTabGenerator.generate(edge, counting, { traceSetVersion: 1 });
        expect(calls).toBe(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts`
Expected: FAIL — `version 1 reproduces…` may pass by luck, but `unknown version falls back` fails (config currently ignored, both already equal) — actually the discriminating failure is the build: after Step 3 these pass; before, the generator ignores config so all three already pass. To get a real red, FIRST add only the test, run, and confirm; if green, that's acceptable here because the behavior is additive — proceed to Step 3 to wire the version and keep them green. (The meaningful new coverage is that version threading does not perturb output or PRNG count.)

- [ ] **Step 3: Rewrite `src/puzzle/topology/traced-tab-generator.ts`** — replace the imports and the `tracedTabVariants` / `tracedTabGenerator` definitions so the version threads through. Full file:

```ts
/**
 * Traced tab generator: produces tab shapes from the photographed library.
 * Uses the tangent-smoothed splicer so the flowy photographed curves join the
 * parent edge with C1 continuity.
 *
 * The trace-set version (from the opaque tab config) selects which frozen,
 * ordered trace list backs the template — see getTracedTemplates. Per edge the
 * generator consumes EXACTLY 3 outer PRNG calls (2 placement + 1 template
 * subSeed) regardless of version or how many retry rungs are tried.
 *
 * Both entry points share one ladder generator, `tracedTabVariants`: it yields
 * the base tab first, then a short "retry ladder" of cheap local variations
 * (sign flip, shrink, shrunk-and-centered). The framework commits the first
 * that survives its crossing checks.
 */

import type { Curve } from './curve.js';
import { createTracedTabTemplate } from '../composable/tab-shapes-traced.js';
import { getTracedTemplates } from '../composable/traces/index.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { scaleBezierPath } from '../composable/bezier-path.js';
import type { BezierPath } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    spliceSmoothedFromPath,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

/** Shrink factor for the "smaller tab" rungs. */
const SHRINK = 0.8;
/** Fraction to pull the tab center toward mid-edge (0.5) on the move rungs. */
const CENTER_PULL = 0.5;

/**
 * Build each version's template once (not per edge). The factory is cheap, but
 * memoizing keeps the per-edge path allocation-free beyond the template's own.
 */
const templatesByVersion = new Map<number, TabTemplate>();
function templateForVersion(version: number): TabTemplate {
    let t = templatesByVersion.get(version);
    if (!t) {
        t = createTracedTabTemplate(getTracedTemplates(version));
        templatesByVersion.set(version, t);
    }
    return t;
}

/**
 * Read the trace-set version from the opaque tab config. Absent / invalid ⇒
 * version 1 (the original set): an un-versioned config is a pre-versioning
 * (legacy) caller and must reproduce against v1. Share-link decode clamps a
 * future version to a known one before it ever reaches here.
 */
function readTraceSetVersion(config: unknown): number {
    const v = (config as { traceSetVersion?: unknown } | null | undefined)?.traceSetVersion;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/**
 * The retry ladder, shared by `generate` and `generateVariants`. All PRNG
 * draws (placement + the one template path) happen before the first yield.
 */
function* tracedTabVariants(
    edge: Curve,
    random: () => number,
    version: number,
): Generator<Curve | null> {
    const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
    if (!placement) return;
    const basePath = templateForVersion(version).generate(random);

    const { tCenter, isTab } = placement;
    const tPulled = tCenter + (0.5 - tCenter) * CENTER_PULL;
    const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);

    const rungs: ReadonlyArray<readonly [number, boolean, BezierPath]> = [
        [tCenter, isTab, basePath],   // base (== generate())
        [tCenter, !isTab, basePath],  // flip sign (first retry)
        [tCenter, isTab, shrunk],     // shrink
        [tPulled, isTab, shrunk],     // shrink + pull-to-center
    ];

    for (const [tc, tab, path] of rungs) {
        yield spliceSmoothedFromPath(edge, tc, tab, path);
    }
}

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, config: unknown): Curve | null {
        const version = readTraceSetVersion(config);
        for (const variant of tracedTabVariants(edge, random, version)) {
            if (variant) return variant;
        }
        return null;
    },

    generateVariants(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null> {
        return tracedTabVariants(edge, random, readTraceSetVersion(config));
    },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts`
Expected: PASS (new + existing tests; the existing "3 outer PRNG calls" and "first variant equals generate()" tests still hold).

- [ ] **Step 5: Commit**

```bash
git add src/puzzle/topology/traced-tab-generator.ts src/puzzle/topology/traced-tab-generator.test.ts
git commit -m "feat(traces): traced generator selects trace set by version"
```

---

### Task 4: Wavy strategy selects traced vs classic; widen `wavyConfig` types

**Files:**
- Modify: `src/game/cut-style-strategies.ts:44` (StrategyContext.wavyConfig) and `:149-181` (wavyStrategy)
- Modify: `src/model/types.ts:203-205` (GameState.wavyConfig)
- Modify: `src/game/init.ts:56` (CreateGameOptions.wavyConfig)
- Create: `src/game/cut-style-strategies.wavy-traced.test.ts`

**Interfaces:**
- Consumes: traced generator accepts `{ traceSetVersion }` in `tabConfig` (Task 3).
- Produces: `ctx.wavyConfig.traceSetVersion` (number, optional) drives `tabGenerator: 'traced'` + `tabConfig: { traceSetVersion }`; absent ⇒ `'classic'` + `{}`. `GameState['wavyConfig']` and `CreateGameOptions['wavyConfig']` both gain optional `traceSetVersion?: number`.

- [ ] **Step 1: Write the failing test** — create `src/game/cut-style-strategies.wavy-traced.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Passthrough mock so we can inspect the config the wavy strategy builds while
// still running real generation (needed to prove the classic path is unchanged
// and the traced path actually generates). See reference_vitest_spy_internal_module_call.
vi.mock('../puzzle/composable-generator.js', async (importActual) => {
    const actual = await importActual<typeof import('../puzzle/composable-generator.js')>();
    return { ...actual, generateComposablePuzzle: vi.fn(actual.generateComposablePuzzle) };
});

import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously in tests (otherwise the stub throws "not loaded").
beforeAll(() => {
    registerTabGenerator(tracedTabGenerator);
});

const grid = { cols: 6, rows: 4 };
const size = { width: 1080, height: 720 };

describe('wavy strategy tab generator selection', () => {
    it('uses classic tabs when no traceSetVersion is set (legacy reproduction)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('wavy').generatePieces(grid, size, 12345, {});
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            grid.cols, grid.rows, size, 12345,
            expect.objectContaining({ tabGenerator: 'classic', tabConfig: {} }),
        );
    });

    it('uses traced tabs with the requested version when traceSetVersion is set', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('wavy').generatePieces(grid, size, 12345, {
            wavyConfig: { traceSetVersion: 1 },
        });
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            grid.cols, grid.rows, size, 12345,
            expect.objectContaining({ tabGenerator: 'traced', tabConfig: { traceSetVersion: 1 } }),
        );
    });

    it('traced wavy is deterministic and differs from classic wavy for the same seed', () => {
        const s = getCutStyleStrategy('wavy');
        const tracedA = s.generatePieces(grid, size, 999, { wavyConfig: { traceSetVersion: 1 } });
        const tracedB = s.generatePieces(grid, size, 999, { wavyConfig: { traceSetVersion: 1 } });
        const classic = s.generatePieces(grid, size, 999, {});
        const shapes = (p: { pieces: { shape: string }[] }) => p.pieces.map((x) => x.shape);
        expect(shapes(tracedB)).toEqual(shapes(tracedA));   // reproducible
        expect(shapes(tracedA)).not.toEqual(shapes(classic)); // traced actually ran
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/cut-style-strategies.wavy-traced.test.ts`
Expected: FAIL — the traced cases fail because `wavyStrategy` still hard-codes `tabGenerator: 'classic'` and ignores `traceSetVersion`; TS also errors on `wavyConfig: { traceSetVersion }` (type not widened yet).

- [ ] **Step 3: Widen `StrategyContext.wavyConfig`** in `src/game/cut-style-strategies.ts:44`:

```ts
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
```

- [ ] **Step 4: Update `wavyStrategy.generatePieces`** in `src/game/cut-style-strategies.ts` (replace the `return generateComposablePuzzle(...)` block, lines 163-178):

```ts
        const traceSetVersion = ctx.wavyConfig?.traceSetVersion;
        const traced = traceSetVersion !== undefined;
        return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: {
                cols: grid.cols,
                rows: grid.rows,
                ha: 0.5,
                hf: grid.cols / 2,
                va: 0.5,
                vf: grid.rows / 2,
            },
            tabGenerator: traced ? 'traced' : 'classic',
            tabConfig: traced ? { traceSetVersion } : {},
            minPieceArea: avgPieceArea / 4,
            borderless: ctx.wavyConfig?.borderless ?? false,
            tabDebug: ctx.tabDebug,
        });
```

- [ ] **Step 5: Widen `GameState.wavyConfig`** in `src/model/types.ts` (replace lines 203-205):

```ts
    wavyConfig?: {
        borderless?: boolean;
        /**
         * Trace-set version for the hand-traced tab shapes. Present on puzzles
         * generated with traced tabs (every new Wavy game); absent on legacy
         * Wavy puzzles, which reproduce with classic tabs. See
         * project_share_link_prng_contract.
         */
        traceSetVersion?: number;
    };
```

- [ ] **Step 6: Widen `CreateGameOptions.wavyConfig`** in `src/game/init.ts:56`:

```ts
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
```

- [ ] **Step 7: Run test + typecheck to verify they pass**

Run: `npx vitest run src/game/cut-style-strategies.wavy-traced.test.ts src/game/cut-style-strategies.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (The existing `cut-style-strategies.test.ts` still passes: with no `wavyConfig`, the classic path is unchanged.)

- [ ] **Step 8: Commit**

```bash
git add src/game/cut-style-strategies.ts src/game/cut-style-strategies.wavy-traced.test.ts src/model/types.ts src/game/init.ts
git commit -m "feat(wavy): generate traced tabs when wavyConfig.traceSetVersion is set"
```

---

### Task 5: Share-link encodes/decodes/guards `wf.tv`

**Files:**
- Modify: `src/sharing/share-link.ts` — payload type (line 53), `assertPayloadNumbersFinite` (after line 85), `decodePayload` (after line 191), new helper, encode (lines 429-431)
- Test: `src/sharing/share-link.test.ts` (append)

**Interfaces:**
- Consumes: `CURRENT_TRACE_SET_VERSION` (Task 1).
- Produces: `SharePayload['wf']` is `{ bl: boolean; tv?: number }`. Encode emits `wf.tv` iff `state.wavyConfig.traceSetVersion` is set. Decode clamps `wf.tv` to `[1, CURRENT_TRACE_SET_VERSION]`; non-number/sub-1 ⇒ field removed (classic).

- [ ] **Step 1: Write the failing test** — append to `src/sharing/share-link.test.ts`:

```ts
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';

// Mirror base64UrlEncode (private) so we can craft adversarial payloads.
function encodeRaw(obj: unknown): string {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wavyState(traceSetVersion?: number): GameState {
    return makeShareGameState({
        cutStyle: 'wavy',
        wavyConfig: traceSetVersion === undefined
            ? { borderless: false }
            : { borderless: false, traceSetVersion },
    });
}

describe('share-link wavy traceSetVersion (wf.tv)', () => {
    it('encodes wf.tv when the wavy config carries a trace-set version', () => {
        const payload = gameStateToPayload(wavyState(1), { includeProgress: false });
        expect(payload.wf).toEqual({ bl: false, tv: 1 });
    });

    it('omits wf.tv for a legacy wavy puzzle (classic tabs)', () => {
        const payload = gameStateToPayload(wavyState(undefined), { includeProgress: false });
        expect(payload.wf).toEqual({ bl: false });
        expect(payload.wf!.tv).toBeUndefined();
    });

    it('round-trips wf.tv through encode/decode', () => {
        const payload = gameStateToPayload(wavyState(1), { includeProgress: false });
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded!.wf).toEqual({ bl: false, tv: 1 });
    });

    it('leaves a legacy wavy link (no tv) without a version', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'wavy', s: 1, r: 'none',
            wf: { bl: false },
        }));
        expect(decoded!.wf!.tv).toBeUndefined();
    });

    it('clamps a future tv down to the newest known version', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'wavy', s: 1, r: 'none',
            wf: { bl: false, tv: 999 },
        }));
        expect(decoded!.wf!.tv).toBe(CURRENT_TRACE_SET_VERSION);
    });

    it('drops a non-positive or non-number tv (reproduces as classic)', () => {
        for (const bad of [0, -3, 'x', null] as unknown[]) {
            const decoded = decodePayload(encodeRaw({
                v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'wavy', s: 1, r: 'none',
                wf: { bl: false, tv: bad },
            }));
            expect(decoded!.wf!.tv).toBeUndefined();
        }
    });
});
```

Use the share-link test file's existing helpers if it already has a `makeShareGameState`/`GameState` factory; otherwise add a minimal `makeShareGameState(overrides)` mirroring the existing fixtures in that file. (Check the top of `share-link.test.ts` for the current fixture name and reuse it; the names above are placeholders for whatever the file already defines.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — `wf.tv` not encoded; decode does not clamp; TS error on `wavyConfig.traceSetVersion` only if the file lacks the widened type (it's widened in Task 4, so this depends on Task 4).

- [ ] **Step 3: Widen the payload type** in `src/sharing/share-link.ts:52-53`:

```ts
    /** Wavy-cut config. `tv` = trace-set version (present ⇒ traced tabs; absent ⇒ classic). */
    wf?: { bl: boolean; tv?: number };
```

- [ ] **Step 4: Guard finiteness on encode** — in `assertPayloadNumbersFinite`, after the `cf` block (after line 85), add:

```ts
    if (payload.c === 'wavy' && payload.wf?.tv !== undefined) {
        check(payload.wf.tv, 'wf.tv');
    }
```

- [ ] **Step 5: Emit `wf.tv` on encode** — replace `gameStateToPayload`'s wavy block (lines 429-431):

```ts
    if (cutStyle === 'wavy' && state.wavyConfig) {
        payload.wf = { bl: state.wavyConfig.borderless ?? false };
        if (state.wavyConfig.traceSetVersion !== undefined) {
            payload.wf.tv = state.wavyConfig.traceSetVersion;
        }
    }
```

- [ ] **Step 6: Add the decode clamp** — add the import near the top of `share-link.ts` and a helper, then call it in `decodePayload`.

Import (with the other imports):

```ts
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';
```

Helper (near `clampSineConfig`):

```ts
/**
 * Bound a decoded wavy trace-set version. A non-number or sub-1 value is
 * dropped (undefined ⇒ the puzzle reproduces with classic tabs, matching
 * pre-versioning links); a version newer than this client knows is clamped
 * down to the newest it can reproduce, so a forward-link still plays.
 */
function clampTraceSetVersion(tv: unknown): number | undefined {
    if (typeof tv !== 'number' || !Number.isFinite(tv)) return undefined;
    const v = Math.floor(tv);
    if (v < 1) return undefined;
    return Math.min(v, CURRENT_TRACE_SET_VERSION);
}
```

In `decodePayload`, after the image clamp (after line 191) and before `return translated;`:

```ts
        if (translated.c === 'wavy' && translated.wf) {
            const clamped = clampTraceSetVersion(translated.wf.tv);
            if (clamped === undefined) delete translated.wf.tv;
            else translated.wf.tv = clamped;
        }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/sharing/share-link.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(share-link): encode, decode, and clamp wavy trace-set version (wf.tv)"
```

---

### Task 6: Save round-trips `traceSetVersion` (regression guard)

**Files:**
- Test only: `src/persistence/serialization.test.ts` (append)

No production change: `serializeStatic`/`deserializeState`/`recombine` copy `wavyConfig` wholesale, so the widened type (Task 4) round-trips automatically. This task locks that with a test so a future refactor can't silently drop the field.

**Interfaces:**
- Consumes: widened `GameState['wavyConfig']` (Task 4).

- [ ] **Step 1: Write the test** — append to `src/persistence/serialization.test.ts`, mirroring the existing `round-trips wavyConfig.borderless…` test (line 230):

```ts
    it('round-trips wavyConfig.traceSetVersion through serializeState/deserializeState', () => {
        const state = makeGameState({
            cutStyle: 'wavy',
            wavyConfig: { borderless: false, traceSetVersion: 1 },
        });
        const restored = deserializeState(serializeState(state));
        expect(restored.wavyConfig).toEqual({ borderless: false, traceSetVersion: 1 });
    });

    it('round-trips wavyConfig.traceSetVersion through serializeStatic/recombine', () => {
        const state = makeGameState({
            cutStyle: 'wavy',
            wavyConfig: { borderless: false, traceSetVersion: 1 },
        });
        const restored = recombine(serializeStatic(state), serializeProgress(state));
        expect(restored.wavyConfig).toEqual({ borderless: false, traceSetVersion: 1 });
    });
```

Use whatever `serializeState`/`serializeProgress` import names the file already has (line 9-14 import block). If `serializeProgress` needs a selection/viewport arg, pass the same defaults the other tests in the file use.

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: PASS (no production change needed; this confirms the field survives).

- [ ] **Step 3: Commit**

```bash
git add src/persistence/serialization.test.ts
git commit -m "test(persistence): lock wavyConfig.traceSetVersion save round-trip"
```

---

### Task 7: Wire preload + version stamping in `main.ts`; preload on Wavy in the dialog

**Files:**
- Modify: `src/main.ts` — import (near line 114), `startNewGame` preload (line 930) + `generatorWavyConfig` (lines 1000-1002), `loadSharedPuzzle` preload (line 1297) + `wavyConfig` (line 1328)
- Modify: `src/ui/new-game-dialog.ts` — cut-style `onSelect` (line 643-649) and initial-open block (after line 661)

`main.ts` and the dialog are integration glue (no isolated unit tests in this repo); they are verified by `tsc`, the existing suite, and the manual run in Task 9.

**Interfaces:**
- Consumes: `CURRENT_TRACE_SET_VERSION` (Task 1); widened `wavyConfig` (Task 4); `wf.tv` (Task 5); `preloadTracedTabGenerator` (already imported at main.ts:114); `options.onPreloadTracedTabs` (already in the dialog).

- [ ] **Step 1: Import the version constant** in `src/main.ts` (near the existing `preloadTracedTabGenerator` import, line 114):

```ts
import { CURRENT_TRACE_SET_VERSION } from './puzzle/composable/traces/trace-set-version.js';
```

- [ ] **Step 2: Preload for new Wavy games** — in `startNewGame`, change the preload condition (line 930) so Wavy (now always traced) also preloads:

```ts
        if (composableConfig?.tabGenerator === 'traced' || cutStyle === 'wavy') {
            await preloadTracedTabGenerator();
        }
```

- [ ] **Step 3: Stamp the current version onto new Wavy games** — replace `generatorWavyConfig` (lines 1000-1002):

```ts
        // Every new Wavy game uses traced tabs at the current trace-set
        // version. Older saves/links carry their own (or no) version and are
        // reproduced verbatim elsewhere; this path only ever creates fresh
        // puzzles, so stamping the current version is always correct.
        const generatorWavyConfig = cutStyle === 'wavy'
            ? {
                borderless: wavyConfig?.borderless ?? false,
                traceSetVersion: CURRENT_TRACE_SET_VERSION,
            }
            : undefined;
```

- [ ] **Step 4: Preload for shared traced-Wavy links** — in `loadSharedPuzzle`, widen the preload condition (line 1297):

```ts
        if (payload.cf?.tg === 'traced'
            || (payload.c === 'wavy' && payload.wf?.tv !== undefined)) {
            await preloadTracedTabGenerator();
        }
```

- [ ] **Step 5: Pass the version through on share-link load** — replace the `wavyConfig` line in `loadSharedPuzzle` (line 1328):

```ts
            wavyConfig: payload.wf
                ? { borderless: payload.wf.bl, traceSetVersion: payload.wf.tv }
                : undefined,
```

(`payload.wf.tv` is `undefined` for legacy links ⇒ classic; the decode clamp in Task 5 has already bounded any present value.)

- [ ] **Step 6: Preload the chunk when the user selects Wavy in the dialog** — in `src/ui/new-game-dialog.ts`, extend the `onSelect` handler (lines 643-649):

```ts
            wavySection.setVisible(id === 'wavy');
            composableSection.setVisible(id === 'composable');
            updateFreeRotationVisibility();
            if (id === 'wavy'
                || (id === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
                options.onPreloadTracedTabs?.();
            }
```

- [ ] **Step 7: Preload on open when Wavy is the initial cut style** — extend the initial-open block (lines 657-661):

```ts
    // Cover the "open with traced tabs already selected" paths so the lazy
    // chunk starts loading even if the user never touches a radio: Wavy (always
    // traced) or Composable with the Traced tab generator saved.
    if (currentCutStyleId === 'wavy'
        || (currentCutStyleId === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
        options.onPreloadTracedTabs?.();
    }
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/ui/new-game-dialog.ts
git commit -m "feat(wavy): stamp + preload traced tabs for new and shared Wavy games"
```

---

### Task 8: Update the in-app help text for Wavy

**Files:**
- Modify: `src/ui/info-modal.ts:200-203` (the Wavy Cut Styles bullet)
- Test: `src/ui/info-modal.test.ts` (the existing Wavy assertions, lines 218-234, must still pass; add one if useful)

The current copy says Wavy has "classic jigsaw tabs," which is now wrong. Keep it short and correct (per `CLAUDE.md`: correct, not exhaustive). Do not add copy for the version mechanism — players don't need it.

**Interfaces:** none.

- [ ] **Step 1: Update the Wavy description** in `src/ui/info-modal.ts` (replace lines 200-203):

```ts
    appendInline(wavyLi, [
        ['strong', 'Wavy'],
        ' — Smooth sinewave edges with hand-traced tab shapes — a more organic, dramatic take on Classic. Options:',
    ]);
```

- [ ] **Step 2: Run the info-modal tests**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS — the existing tests ("mentions Wavy as a cut style", "mentions Free rotation in the Wavy bullet") still hold; the wavyConfig repro-block test (line 110) is unaffected (it uses `{ borderless: true }` with no version).

- [ ] **Step 3: Commit**

```bash
git add src/ui/info-modal.ts
git commit -m "docs: Wavy help text reflects hand-traced tabs"
```

---

### Task 9: Full verification + manual app check

**Files:** none (verification only).

- [ ] **Step 1: Full test suite, typecheck, and build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS; no type errors; build succeeds.

- [ ] **Step 2: Manual verification** (use the `verify`/`run` skill to launch the app):

1. New game → **Wavy** → create. Confirm tabs look hand-traced/organic (not the classic mushroom), on the sinewave edges.
2. Reload the page → the saved Wavy puzzle restores with the same traced tabs and your progress.
3. **Share** the Wavy puzzle → open the link in a fresh/incognito session → identical traced puzzle.
4. Open a **pre-existing Wavy share-link** captured from `main` before this change (or hand-craft one with `wf:{bl:false}` and no `tv`) → it reproduces with **classic** tabs, unchanged.
5. New game → **Wavy + Borderless** → confirm traced tabs on all four sides and net piece count matches the chosen size.

- [ ] **Step 3: Record any manual findings.** If a manual step fails, stop and fix before merge; do not claim completion on a failed step.

---

## Self-Review

**Spec coverage:**
- Versioned manifest + `CURRENT_TRACE_SET_VERSION` → Task 1. ✓
- Generator reads version, sub-PRNG/3-call contract preserved → Tasks 2, 3. ✓
- Wavy strategy picks generator by config; types widened → Task 4. ✓
- `wf.tv` present⇒traced / absent⇒classic; DoS clamp; forward-compat clamp-down → Task 5. ✓
- Save stores `traceSetVersion`, no `STATE_VERSION` bump → Task 6 (type flows; guarded by test). ✓
- Async preload at new-game + share-link load; save reload needs none → Task 7. ✓
- Composable defaults to v1 when absent → covered by `readTraceSetVersion` default (Task 3). ✓
- Help text review/update → Task 8. ✓
- Regression linchpin (legacy classic-Wavy unchanged) → Task 4 classic-path arg test + existing `cut-style-strategies.test.ts`; traced-vs-classic divergence test. ✓
- Manual verification → Task 9. ✓

**Placeholder scan:** Task 5 notes the share-link test fixture name may differ in the file — flagged explicitly to reuse the existing factory rather than left as a silent gap. Task 6 likewise notes reusing the file's existing `serializeState`/`serializeProgress` names. No "TBD"/"add error handling"-style gaps.

**Type consistency:** `traceSetVersion?: number` is used identically in `StrategyContext.wavyConfig`, `GameState['wavyConfig']`, `CreateGameOptions['wavyConfig']`, and (as `tv?: number`) `SharePayload['wf']`. `getTracedTemplates(version: number)`, `createTracedTabTemplate(templates)`, `readTraceSetVersion(config)`, and `CURRENT_TRACE_SET_VERSION` names match across Tasks 1, 3, 5, 7.
