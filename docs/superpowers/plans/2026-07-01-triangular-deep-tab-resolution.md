# Triangular Deep Tab Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the traced tab resolver a deeper fallback ladder — inversion at every level plus progressively smaller scales — but only for the triangular base cut, so cramped triangular pieces get tabs more often.

**Architecture:** The traced generator's `tracedTabVariants` gains a `deep` flag. When off (every non-triangular cut) it yields today's exact four rungs, byte-identical. When on it yields a 10-rung ladder: each of four scales (1.0, 0.8, 0.64, 0.512) tried upright then inverted, then a final center-pull tier at the smallest scale (upright, inverted). The flag is derived in `generateTopologyPuzzle` from `baseCutId === 'triangular'` and merged into the opaque `tabConfig`, so it reaches the generator through the existing config channel with no interface change and no new plumbing site to forget.

**Tech Stack:** TypeScript, Vitest, Vite. Pure geometry — no DOM/canvas.

## Global Constraints

- **PRNG contract is immutable.** `tracedTabVariants` must draw exactly 3 outer `random()` calls per edge (2 placement + 1 template subseed), all before the first `yield`, regardless of `deep` or how many rungs are pulled. Adding rungs must NOT add draws. (Guarded by existing tests.)
- **Default ladder stays byte-identical.** The non-`deep` path must yield the same four rungs (`base, flip, shrink 0.8, shrink 0.8 + center`) in the same order as today, so Wavy (production) and sine-composable share links are unchanged.
- **American English** for all identifiers and comments (e.g. `center`, not `centre`).
- **No help-text change.** Triangular is a dev-only composable base cut, undocumented in `info-modal.ts`; this change adds no user-facing control. Do not edit the info modal.
- **Triangular is unreleased**, so changing its tab output is safe — no share-link reproduction contract to preserve for it.

---

### Task 1: Deep ladder in the traced tab generator

**Files:**
- Modify: `src/puzzle/topology/traced-tab-generator.ts`
- Test: `src/puzzle/topology/traced-tab-generator.test.ts`

**Interfaces:**
- Consumes: `scaleBezierPath`, `spliceSmoothedFromPath`, `computeTabPlacement`, `DEFAULT_TAB_PLACEMENT` (all already imported); `BezierPath`, `Curve` types.
- Produces: `tracedTabGenerator.generateVariants(edge, random, config)` now reads a boolean `deepResolve` off the opaque `config`. When `config.deepResolve === true` it yields 10 rungs; otherwise 4 (unchanged). `generate()` behavior is unchanged (returns the base rung).

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/puzzle/topology/traced-tab-generator.test.ts`, inside the existing `describe('tracedTabGenerator.generateVariants', ...)` block (after the current tests):

```ts
    it('default ladder (no deepResolve) yields exactly the 4 original rungs', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const all = [...tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {})];
        expect(all).toHaveLength(4);
    });

    it('deepResolve yields the 10-rung deep ladder', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const all = [
            ...tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {
                deepResolve: true,
            }),
        ];
        expect(all).toHaveLength(10);
    });

    it('deep ladder shares its first three rungs with the default ladder', () => {
        // Order contract: place -> invert -> shrink0.8 are identical in both
        // ladders (deep only diverges at rung 3, where it inverts the 0.8 tab
        // instead of pulling toward center).
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const def = [...tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {})];
        const deep = [
            ...tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {
                deepResolve: true,
            }),
        ];
        for (let i = 0; i < 3; i++) {
            expect(deep[i]).not.toBeNull();
            expect(def[i]).not.toBeNull();
            expect(deep[i]!.segments).toEqual(def[i]!.segments);
        }
        // Diverges at rung 3.
        expect(deep[3]!.segments).not.toEqual(def[3]!.segments);
    });

    it('deep ladder still consumes exactly 3 outer PRNG calls', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        let calls = 0;
        const counting = () => { calls++; return 0.5; };
        const all = [
            ...tracedTabGenerator.generateVariants!(edge, counting, { deepResolve: true }),
        ];
        expect(all).toHaveLength(10);
        expect(calls).toBe(3);
    });

    it('every deep-ladder variant keeps the edge endpoints', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        for (const v of tracedTabGenerator.generateVariants!(edge, createSeededRandom(3), {
            deepResolve: true,
        })) {
            if (!v) continue;
            expect(v.start.x).toBeCloseTo(0);
            expect(v.end.x).toBeCloseTo(240);
        }
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts`
Expected: FAIL — the deep tests fail (the current ladder yields 4 rungs even with `deepResolve`, so the length-10 and 3-rung-share assertions fail).

- [ ] **Step 3: Implement the deep ladder**

In `src/puzzle/topology/traced-tab-generator.ts`:

Add, just after the `CENTER_PULL` constant (around line 34):

```ts
/**
 * Scale factors for the deep ladder (triangular base cut): full size, then
 * three steps of *0.8, so the smallest tab is ~0.51 of full. Each scale is
 * tried upright then inverted before dropping to the next, smaller one.
 */
const DEEP_SCALES = [1, SHRINK, SHRINK * SHRINK, SHRINK * SHRINK * SHRINK] as const;

/** One ladder rung: tab center position, tab/blank orientation, tab path. */
type Rung = readonly [number, boolean, BezierPath];

/**
 * Read the deep-resolution flag from the opaque tab config. The generator
 * itself is base-cut agnostic; `generateTopologyPuzzle` sets this only for the
 * triangular cut, whose cramped pieces reject the shallow ladder too often.
 */
function readDeepResolve(config: unknown): boolean {
    return (config as { deepResolve?: unknown } | null | undefined)?.deepResolve === true;
}

/** Today's shallow ladder: base, flip, shrink, shrink+center. */
function defaultRungs(
    basePath: BezierPath,
    tCenter: number,
    tPulled: number,
    isTab: boolean,
): readonly Rung[] {
    const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);
    return [
        [tCenter, isTab, basePath],   // base (== generate())
        [tCenter, !isTab, basePath],  // flip sign
        [tCenter, isTab, shrunk],     // shrink
        [tPulled, isTab, shrunk],     // shrink + pull-to-center
    ];
}

/**
 * Deep ladder for triangular cuts. Each scale is tried upright then inverted
 * (place -> invert -> scale -> scale+invert -> ...), then a final center-pull
 * tier at the smallest scale (upright, inverted) as a last resort. All rungs
 * are cheap local variations; the framework commits the first that survives
 * its crossing checks, so an edge takes the largest, most-upright tab that fits.
 */
function deepRungs(
    basePath: BezierPath,
    tCenter: number,
    tPulled: number,
    isTab: boolean,
): readonly Rung[] {
    const s1 = scaleBezierPath(basePath, DEEP_SCALES[1], DEEP_SCALES[1]);
    const s2 = scaleBezierPath(basePath, DEEP_SCALES[2], DEEP_SCALES[2]);
    const s3 = scaleBezierPath(basePath, DEEP_SCALES[3], DEEP_SCALES[3]);
    return [
        [tCenter, isTab, basePath], [tCenter, !isTab, basePath], // 1.0
        [tCenter, isTab, s1],       [tCenter, !isTab, s1],       // 0.8
        [tCenter, isTab, s2],       [tCenter, !isTab, s2],       // 0.64
        [tCenter, isTab, s3],       [tCenter, !isTab, s3],       // 0.512
        [tPulled, isTab, s3],       [tPulled, !isTab, s3],       // 0.512 + center
    ];
}
```

Replace the body of `tracedTabVariants` (currently lines ~65-88). Change its signature to accept `deep` and delegate rung construction:

```ts
function* tracedTabVariants(
    edge: Curve,
    random: () => number,
    version: number,
    deep: boolean,
): Generator<Curve | null> {
    const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
    if (!placement) return;
    const basePath = templateForVersion(version).generate(random);

    const { tCenter, isTab } = placement;
    const tPulled = tCenter + (0.5 - tCenter) * CENTER_PULL;

    const rungs = deep
        ? deepRungs(basePath, tCenter, tPulled, isTab)
        : defaultRungs(basePath, tCenter, tPulled, isTab);

    for (const [tc, tab, path] of rungs) {
        yield spliceSmoothedFromPath(edge, tc, tab, path);
    }
}
```

Update both entry points to pass `deep`:

```ts
    generate(edge: Curve, random: () => number, config: unknown): Curve | null {
        const version = readTraceSetVersion(config);
        const deep = readDeepResolve(config);
        for (const variant of tracedTabVariants(edge, random, version, deep)) {
            if (variant) return variant;
        }
        return null;
    },

    generateVariants(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null> {
        return tracedTabVariants(
            edge,
            random,
            readTraceSetVersion(config),
            readDeepResolve(config),
        );
    },
```

Also update the module-level doc comment (lines ~11-14) to mention the deep ladder, e.g. append: "When the opaque config sets `deepResolve` (triangular cuts), the ladder expands to scale×invert rungs plus a smallest-scale center-pull tier; the PRNG draw count is unchanged."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/puzzle/topology/traced-tab-generator.test.ts`
Expected: PASS — all tests, including the pre-existing ones (default ladder still 4 rungs, first variant equals `generate()`, 3 PRNG calls).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/puzzle/topology/traced-tab-generator.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/traced-tab-generator.ts src/puzzle/topology/traced-tab-generator.test.ts
git commit -m "feat(topology): deep tab-resolution ladder for cramped cuts

Add a deepResolve mode to the traced generator: each scale (1.0, 0.8,
0.64, 0.512) tried upright then inverted, plus a smallest-scale
center-pull tier. Default (non-deep) ladder is byte-identical; PRNG
draw count unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 2: Gate the deep ladder to the triangular base cut

**Files:**
- Modify: `src/puzzle/topology/generator.ts:169-172` (the `applyTabs` call)
- Test: `src/puzzle/topology/generator.test.ts`

**Interfaces:**
- Consumes: `baseCutId` (already computed at `generator.ts:129`), `config?.tabConfig` (`Record<string, unknown> | undefined`), `registerTabGenerator` from `generator-registry.js`, `TabGenerator` from `plugin-types.js`.
- Produces: when `baseCutId === 'triangular'`, the `tabConfig` handed to `applyTabs` (and thus to `generateVariants`) carries `deepResolve: true`; for any other base cut it is passed through unchanged.

Note: the traced generator ships behind a lazy stub (`traced-tab-loader.ts`) that forwards `(edge, random, config)` to the real `generateVariants` unchanged. `deepResolve` rides inside `config`, so it reaches the real generator through the stub with no loader change needed.

- [ ] **Step 1: Write the failing test**

Add to `src/puzzle/topology/generator.test.ts`. Put the helper and tests in a new `describe` block at the end of the file:

```ts
describe('generateTopologyPuzzle deep-resolution gating', () => {
    // A fake tab generator that records the opaque config it is handed, so we
    // can assert the deepResolve flag is threaded through the real generator
    // path (not by reading generator internals). Applies no tabs.
    function recordingTabGenerator(id: string, sink: { config?: unknown }): TabGenerator {
        return {
            id,
            generate: () => null,
            generateVariants: (_edge, _random, config) => {
                sink.config = config;
                return [];
            },
        };
    }

    it('sets deepResolve for the triangular base cut', () => {
        const sink: { config?: unknown } = {};
        registerTabGenerator(recordingTabGenerator('test-record-triangular', sink));
        generateTopologyPuzzle(6, 6, { width: 600, height: 600 }, seededRandom(42), {
            baseCutGeneratorId: 'triangular',
            baseCutConfig: { jitter: 0.1 },
            tabGeneratorId: 'test-record-triangular',
        });
        expect((sink.config as { deepResolve?: unknown }).deepResolve).toBe(true);
    });

    it('does not set deepResolve for a non-triangular base cut', () => {
        const sink: { config?: unknown } = {};
        registerTabGenerator(recordingTabGenerator('test-record-sine', sink));
        generateTopologyPuzzle(6, 6, { width: 600, height: 600 }, seededRandom(42), {
            baseCutGeneratorId: 'sine',
            baseCutConfig: { ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 },
            tabGeneratorId: 'test-record-sine',
        });
        expect((sink.config as { deepResolve?: unknown } | undefined)?.deepResolve).not.toBe(true);
    });
});
```

Add the imports at the top of the test file (extend the existing import lines):

```ts
import { registerBaseCutGenerator, registerTabGenerator } from './generator-registry.js';
import type { BaseCutGenerator, TabGenerator } from './plugin-types.js';
```

(The file already imports `registerBaseCutGenerator` and `BaseCutGenerator`; add `registerTabGenerator` and `TabGenerator` to those same import statements rather than duplicating them.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/puzzle/topology/generator.test.ts -t "deep-resolution gating"`
Expected: FAIL — the triangular case sees `deepResolve` undefined (the flag isn't wired yet).

- [ ] **Step 3: Wire the gate in generator.ts**

In `src/puzzle/topology/generator.ts`, replace the `applyTabs` call (lines ~168-172):

```ts
    const tabGenerator = getTabGenerator(tabId);
    // Triangular pieces have little interior room, so the traced resolver's
    // shallow ladder leaves many edges flat. Opt those cuts into the deep
    // ladder via the opaque tab config; every other cut keeps today's ladder
    // (and its exact share-link output). Derived here, from baseCutId, so no
    // config-construction site can forget to set it.
    const tabConfig =
        baseCutId === 'triangular'
            ? { ...(config?.tabConfig ?? {}), deepResolve: true }
            : config?.tabConfig;
    applyTabs(graph, tabGenerator, random, {
        tabConfig,
        onCandidate: config?.tabDebug?.onCandidate,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/puzzle/topology/generator.test.ts -t "deep-resolution gating"`
Expected: PASS — both the triangular and sine cases.

- [ ] **Step 5: Run the full topology suite + typecheck**

Run: `npx vitest run src/puzzle/topology && npx tsc --noEmit`
Expected: PASS — no regressions (default ladder unchanged, so `apply-tabs.test.ts` and the sine measurement labels stay valid).

- [ ] **Step 6: Commit**

```bash
git add src/puzzle/topology/generator.ts src/puzzle/topology/generator.test.ts
git commit -m "feat(topology): opt triangular cuts into the deep tab ladder

Derive deepResolve from baseCutId in generateTopologyPuzzle and merge it
into the opaque tabConfig, so only the (unreleased) triangular cut gets
the deeper resolver. Wavy/sine output is unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

### Task 3 (optional): Triangular deep-ladder measurement

Skip unless you want a number for the flat-edge improvement. Purely a manual measurement harness (gated by `MEASURE_TABS=1`), never a CI gate.

**Files:**
- Modify: `src/puzzle/topology/tab-rejection-measurement.test.ts`

**Interfaces:**
- Consumes: `triangularCutGenerator` from `./triangular-cut-generator.js`, the same `preloadTracedTabGenerator` / `getTabGenerator('traced')` / `buildDCEL` / `applyTabs` path the existing measurement uses.
- Produces: a second gated `it` that reports triangular flat-edge rate with the deep ladder. No non-gated assertion changes.

- [ ] **Step 1: Add the measurement case**

Add inside the existing `describe('traced-tab rejection measurement', ...)` block, after the current `it`:

```ts
    (RUN ? it : it.skip)('reports the triangular flat-edge rate with the deep ladder', { timeout: 300_000 }, async () => {
        const frame = { width: 1600, height: 1200 };
        const SEEDS = 15;
        await preloadTracedTabGenerator();
        const generator = getTabGenerator('traced');

        let total = 0;
        let accepted = 0;
        // Deep ladder has 10 rungs (see deepRungs in traced-tab-generator.ts):
        // scale x invert for 1.0/0.8/0.64/0.512, then 0.512 center upright/invert.
        const rungCommits = new Array(10).fill(0);
        for (let s = 0; s < SEEDS; s++) {
            const random = createSeededRandom(s);
            const curves = triangularCutGenerator.generate(frame, random, {
                cols: 16,
                rows: 12,
                jitter: 0.1,
            });
            const graph = buildDCEL({ curves });
            applyTabs(graph, generator, random, {
                tabConfig: { deepResolve: true },
                onCandidate: (_he, ok, idx) => {
                    total++;
                    if (ok) {
                        accepted++;
                        if (idx !== undefined && idx < rungCommits.length) rungCommits[idx]++;
                    }
                },
            });
        }
        const rejectPct = (100 * (total - accepted)) / total;
        // eslint-disable-next-line no-console
        console.log(`[triangular] eligible=${total} accepted=${accepted} flat=${total - accepted} reject=${rejectPct.toFixed(1)}%`);
        // eslint-disable-next-line no-console
        console.log(`[triangular] per-rung commits: ${rungCommits.join(',')}`);
        expect(total).toBeGreaterThan(0);
    });
```

Add the import at the top: `import { triangularCutGenerator } from './triangular-cut-generator.js';`

- [ ] **Step 2: Run it manually**

Run: `MEASURE_TABS=1 npx vitest run src/puzzle/topology/tab-rejection-measurement.test.ts`
Expected: PASS; console shows the triangular flat-edge rate and per-rung commits. Compare the flat rate against a quick run with `tabConfig: {}` (shallow ladder) to confirm the deep ladder recovers edges.

- [ ] **Step 3: Commit**

```bash
git add src/puzzle/topology/tab-rejection-measurement.test.ts
git commit -m "test(topology): measure triangular flat-edge rate with deep ladder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AtPUje14CAshHjzF5NVcTR"
```

---

## Final verification

- [ ] Run the full test suite: `npx vitest run` — all pass.
- [ ] `npx tsc --noEmit && npx eslint src` — clean.
- [ ] Re-run the triangular worst-case timing test (recently re-enabled) to confirm the 4→10 rung increase stays within the curve/timing budget on cramped edges. If it regresses materially, reduce `DEEP_SCALES` depth (drop the 0.512 level) rather than widening the timing tolerance.
- [ ] Manually: generate a triangular puzzle in the dev composable UI with the traced tab set and confirm noticeably fewer flat edges than before.
