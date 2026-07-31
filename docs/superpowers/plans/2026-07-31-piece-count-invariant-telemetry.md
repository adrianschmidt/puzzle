# Piece-Count Invariant Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect puzzles generated with the wrong piece count, and report the parameters needed to replay that exact puzzle to Umami, so a field failure can be reproduced locally and turned into a regression test.

**Architecture:** An optional `expectedPieceCount(config)` hook on `BaseCutGenerator` lets a generator declare its intended face count. `generateTopologyPuzzle` compares it against `pieceDefs.length` before composition and before the borderless strip, and returns any mismatch as data on its result. That data rides up through `StrategyPuzzle` to an optional `onPieceCountMismatch` callback on `InitOptions`, which the two app-layer start flows use to emit a `piece-count-mismatch` event carrying repro params.

**Tech Stack:** TypeScript (ESM, `verbatimModuleSyntax`), Vite, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-piece-count-invariant-telemetry-design.md`. Read it first.
- **Never throw on mismatch.** A wrong count is a bad puzzle, not an unusable one. `diagnostics.warn` + the event, nothing else.
- **Do not change the seeded PRNG call count or order anywhere.** The number and order of `random()` calls during generation is the share-link reproducibility contract. Nothing in this plan may draw randomness. See `CLAUDE.md` § "Isolate new seeded randomness behind a sub-PRNG".
- **Do not re-record `dcel-broad-phase-equivalence.test.ts`.** If those digests go red, geometry moved and something in this plan is wrong. Never run `vitest -u` on it.
- **Umami event-data limits are the payload contract:** strings ≤500 chars, numbers max precision 4, arrays stringified to ≤500 chars, objects ≤50 properties.
- **`imageUrl` is never sent.** Deliberate; see the spec's "imageUrl is deliberately omitted".
- **All changes are additive.** No existing exported signature changes — `createNewGame` has 33 test call sites that must not move.
- **American English** in all identifiers, comments and copy.
- **`umami.ts` doc comments are the operator-facing query spec.** Queries get written from them, so a wrong claim there is a real defect.
- Run the full suite with `npm test`. Run one file with `npx vitest run <path>`.
- No info-modal change: a mismatch is invisible to players.

---

### Task 1: The detector in the topology layer

**Files:**
- Modify: `src/puzzle/topology/plugin-types.ts:28-56` (add the hook to `BaseCutGenerator`)
- Modify: `src/puzzle/topology/sine-cut-generator.ts:42-45` (implement it)
- Modify: `src/puzzle/topology/generator.ts:100-110` (add `pieceCountMismatch` to `TopologyPuzzle`), `:199-202` (the check), `:255` (the return)
- Test: `src/puzzle/topology/sine-cut-generator.test.ts`, `src/puzzle/topology/generator.test.ts`, `src/puzzle/topology/repro-bug.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BaseCutGenerator.expectedPieceCount?(config: unknown): number | undefined`
  - `export interface PieceCountMismatch { expected: number; actual: number; baseCutId: string; }` exported from `src/puzzle/topology/generator.ts`
  - `TopologyPuzzle.pieceCountMismatch?: PieceCountMismatch`

- [ ] **Step 1: Write the failing test for the sine hook**

Append to `src/puzzle/topology/sine-cut-generator.test.ts`:

```ts
describe('sineCutGenerator.expectedPieceCount', () => {
    it('is cols x rows for a bordered grid', () => {
        expect(sineCutGenerator.expectedPieceCount?.({ cols: 16, rows: 12 })).toBe(192);
    });

    it('oversizes by one piece on each side when borderless', () => {
        // The generator adds +2 cols and +2 rows internally, and the check
        // runs BEFORE stripBorderRing, so the expectation is the oversized grid.
        expect(
            sineCutGenerator.expectedPieceCount?.({ cols: 16, rows: 12, borderless: true }),
        ).toBe(18 * 14);
    });

    it('mirrors generate()`s fallbacks for a config with no dims', () => {
        // generate() falls back to `cfg.cols ?? 1` / `cfg.rows ?? 1`, so the
        // expectation must use the same defaults or it would report a false
        // mismatch for `baseCutConfig: {}`.
        expect(sineCutGenerator.expectedPieceCount?.({})).toBe(1);
        expect(sineCutGenerator.expectedPieceCount?.(undefined)).toBe(1);
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: FAIL — `expectedPieceCount` is not a property of `sineCutGenerator`, so the optional call returns `undefined` and every `toBe` fails.

- [ ] **Step 3: Add the hook to the interface**

In `src/puzzle/topology/plugin-types.ts`, inside `interface BaseCutGenerator`, after `supportsBorderless`:

```ts
    /**
     * The number of faces this generator intends to produce for `config`,
     * or undefined when it cannot say.
     *
     * Receives the SAME opaque config object `generate` gets, so a generator
     * applies its own sizing rule (borderless oversizing included) without the
     * framework having to encode it. The framework compares the value against
     * the faces actually extracted, BEFORE composition and BEFORE the border
     * strip, and reports a mismatch (see `TopologyPuzzle.pieceCountMismatch`).
     *
     * Optional on purpose. Only a generator whose output count is a knowable
     * function of its config should implement it — Venn circles and the
     * triangular lattice produce counts unrelated to cols x rows, so they omit
     * it and are exempt rather than permanently false-positive.
     */
    expectedPieceCount?(config: unknown): number | undefined;
```

- [ ] **Step 4: Implement it for the sine grid**

In `src/puzzle/topology/sine-cut-generator.ts`, add to the `sineCutGenerator` object, immediately after `supportsBorderless: true,`:

```ts
    expectedPieceCount(config: unknown): number {
        // Mirrors generate()'s own reading of the config exactly — same
        // defaults, same borderless oversizing. If generate() changes how it
        // derives its grid, this must change with it or the framework will
        // report a mismatch that isn't one.
        const cfg = (config ?? {}) as Partial<SineCutConfig>;
        const extra = cfg.borderless === true ? 2 : 0;
        return ((cfg.cols ?? 1) + extra) * ((cfg.rows ?? 1) + extra);
    },
```

- [ ] **Step 5: Run the sine tests**

Run: `npx vitest run src/puzzle/topology/sine-cut-generator.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the framework check**

Append to `src/puzzle/topology/generator.test.ts`. The fake follows the existing pattern at `generator.test.ts:255-278`:

```ts
describe('generateTopologyPuzzle piece-count invariant', () => {
    const FRAME_400 = { width: 400, height: 400 };

    it('reports a mismatch when a generator produces fewer faces than it declared', () => {
        // Declares a 2x2 grid but emits only the horizontal internal cut, so
        // the DCEL extracts 2 faces, not 4. This is the shape of the real
        // failure mode (a missed cut crossing fusing faces) without depending
        // on a bug that is now fixed.
        const fake: BaseCutGenerator = {
            id: 'fake-declares-4-emits-2',
            expectedPieceCount: () => 4,
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
            ],
        };
        registerBaseCutGenerator(fake);

        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME_400, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieces).toHaveLength(2);
        expect(pieceCountMismatch).toEqual({
            expected: 4,
            actual: 2,
            baseCutId: 'fake-declares-4-emits-2',
        });
    });

    it('reports nothing when the declared count matches', () => {
        const fake: BaseCutGenerator = {
            id: 'fake-declares-4-emits-4',
            expectedPieceCount: () => 4,
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
                Curve.line({ x: 200, y: 0 }, { x: 200, y: 400 }),
            ],
        };
        registerBaseCutGenerator(fake);

        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME_400, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieces).toHaveLength(4);
        expect(pieceCountMismatch).toBeUndefined();
    });

    it('exempts a generator that declares no expected count', () => {
        // Same 2-face output as the mismatch case, but no hook -> no report.
        const fake: BaseCutGenerator = {
            id: 'fake-no-expectation',
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
            ],
        };
        registerBaseCutGenerator(fake);

        const { pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME_400, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieceCountMismatch).toBeUndefined();
    });

    it.each(['venn', 'triangular'])(
        'exempts the real %s generator, which declares no count',
        (baseCutGeneratorId) => {
            // These legitimately produce counts unrelated to cols x rows. If
            // someone later adds an expectedPieceCount to either, this test
            // goes red and forces them to prove the derivation is right.
            expect(getBaseCutGenerator(baseCutGeneratorId).expectedPieceCount)
                .toBeUndefined();
        },
    );

    it('compares against the pre-strip count in borderless mode', () => {
        // The sine grid oversizes to 4x4 = 16 faces, then the strip removes the
        // outer ring leaving 4 pieces. The check must see 16 vs 16, not 4 vs 16.
        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME_400, rng,
            { baseCutGeneratorId: 'sine', tabGeneratorId: 'none', minPieceArea: 0,
              baseCutConfig: { cols: 2, rows: 2 }, borderless: true },
        );

        expect(pieces).toHaveLength(4);
        expect(pieceCountMismatch).toBeUndefined();
    });
});
```

Check the top of `generator.test.ts` and add whatever of `BaseCutGenerator`, `Curve`, `registerBaseCutGenerator`, `getBaseCutGenerator` is not already imported. `rng` and `FRAME` already exist in that file — reuse the existing `rng` rather than creating one, and confirm its name before running.

Note the registry has no unregister and is module-level, so these fakes stay registered for the rest of the file's run. That is why each has a distinct, self-describing id — reusing one id across tests would silently give a later test the earlier test's generator.

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run src/puzzle/topology/generator.test.ts`
Expected: FAIL — `pieceCountMismatch` does not exist on the result, so it is `undefined` and the first test's `toEqual` fails.

- [ ] **Step 8: Add the result type**

In `src/puzzle/topology/generator.ts`, above `export interface TopologyPuzzle`:

```ts
/**
 * A generated puzzle whose face count did not match what its base-cut
 * generator declared via {@link BaseCutGenerator.expectedPieceCount}.
 *
 * Both counts are pre-composition and pre-border-strip, so they are directly
 * comparable: for a borderless puzzle they describe the oversized grid, not
 * the smaller set the player ends up with.
 *
 * This is a diagnostic, not an error. The puzzle is returned and played as
 * normal; the count is reported so a fused-piece bug stops being invisible
 * (#512).
 */
export interface PieceCountMismatch {
    /** Faces the base-cut generator intended to produce. */
    expected: number;
    /** Faces the DCEL actually yielded. */
    actual: number;
    /** Which base-cut generator declared the expectation. */
    baseCutId: string;
}
```

Then add to `interface TopologyPuzzle`, after `tabDebugReport`:

```ts
    /**
     * Set only when the base cut declared an expected face count and the
     * pipeline produced a different one. Absent is the normal case, and is
     * also what every generator without an `expectedPieceCount` hook returns.
     */
    pieceCountMismatch?: PieceCountMismatch;
```

- [ ] **Step 9: Implement the check**

In `src/puzzle/topology/generator.ts`, immediately after the existing
`diagnostics.log('pieces', ...)` call at line 201:

```ts
    // Piece-count invariant (#512). Deliberately placed here: before
    // composePuzzle and before stripBorderRing, so `expected` (which the
    // generator computes for its own oversized grid) and `actual` are in the
    // same coordinate system and no strip arithmetic is needed.
    //
    // Warn, never throw — a wrong count is a bad puzzle, not an unusable one,
    // and throwing here would turn a cosmetic defect into a failed game start.
    let pieceCountMismatch: PieceCountMismatch | undefined;
    const expectedPieces = baseCutGenerator.expectedPieceCount?.(baseCutCfg);
    if (expectedPieces !== undefined && expectedPieces !== pieceDefs.length) {
        pieceCountMismatch = {
            expected: expectedPieces,
            actual: pieceDefs.length,
            baseCutId,
        };
        diagnostics.warn(
            `[piece-count] ${baseCutId} expected ${expectedPieces} pieces, got ${pieceDefs.length}`,
        );
    }
```

Then extend the return at the end of the function:

```ts
    return { pieces, autoGroups: finalAutoGroups, tabDebugReport, pieceCountMismatch };
```

- [ ] **Step 10: Run the generator tests**

Run: `npx vitest run src/puzzle/topology/generator.test.ts`
Expected: PASS, all four new tests plus the existing ones.

- [ ] **Step 11: Turn the three historical cases into detector guards**

In `src/puzzle/topology/repro-bug.test.ts`, each of the three `it` blocks
currently destructures `{ pieces }`. Change each to also destructure
`pieceCountMismatch` and assert it, keeping the existing length assertion:

```ts
        const { pieces, pieceCountMismatch } = generateComposablePuzzle(
            /* ...unchanged arguments... */
        );
        expect(pieces).toHaveLength(192);
        expect(pieceCountMismatch).toBeUndefined();
```

Add to the file header comment, after the numbered list of causes:

```
 * Each case now also asserts `pieceCountMismatch` is undefined. All three
 * bugs are fixed, so none of them can demonstrate the detector firing — what
 * these assertions buy is the reverse: if one of the three ever regresses,
 * the detector is proven to catch it rather than merely assumed to. The
 * detector firing is covered in generator.test.ts with a fake generator.
```

- [ ] **Step 12: Run the regression file**

Run: `npx vitest run src/puzzle/topology/repro-bug.test.ts`
Expected: PASS. These are slow (up to 15s each by design).

- [ ] **Step 13: Confirm no geometry moved**

Run: `npx vitest run src/puzzle/topology/dcel-broad-phase-equivalence.test.ts`
Expected: PASS. Nothing in this task draws randomness or alters curves, so the digests must be untouched. **If this goes red, stop — do not re-record.** Something in Step 9 changed generation rather than observing it.

- [ ] **Step 14: Commit**

```bash
git add src/puzzle/topology/
git commit -m "feat(topology): detect puzzles generated with the wrong piece count

An optional expectedPieceCount hook on BaseCutGenerator lets a generator
declare its intended face count; the framework compares it against the
faces extracted, before composition and before the border strip, and
reports any mismatch on the result.

Implemented for the sine grid only. Venn and the triangular lattice
produce counts unrelated to cols x rows, so they omit the hook and are
exempt rather than permanently false-positive.

Warns rather than throws: a wrong count is a bad puzzle, not an unusable
one. Refs #512."
```

---

### Task 2: Carry the mismatch up to the app layer

**Files:**
- Modify: `src/game/cut-style-strategies.ts:70-75` (`StrategyPuzzle`)
- Modify: `src/game/init.ts:46-71` (`InitOptions`), `:106-107` (invoke)
- Test: `src/game/init.test.ts`

**Interfaces:**
- Consumes: `PieceCountMismatch`, `TopologyPuzzle.pieceCountMismatch` from Task 1.
- Produces: `InitOptions.onPieceCountMismatch?: (mismatch: PieceCountMismatch) => void`

- [ ] **Step 1: Write the failing test**

Append to `src/game/init.test.ts`. Read the top of that file first and reuse
its existing image-size/viewport constants rather than inventing new ones:

```ts
describe('createNewGame piece-count mismatch reporting', () => {
    it('does not call the callback for a healthy puzzle', () => {
        const onPieceCountMismatch = vi.fn();
        createNewGame('img.jpg', { width: 400, height: 400 },
            { width: 800, height: 600 }, { cols: 2, rows: 2 },
            { seed: 1, cutStyle: 'classic', onPieceCountMismatch });
        expect(onPieceCountMismatch).not.toHaveBeenCalled();
    });

    it('is optional — a caller that omits it still generates', () => {
        expect(() =>
            createNewGame('img.jpg', { width: 400, height: 400 },
                { width: 800, height: 600 }, { cols: 2, rows: 2 },
                { seed: 1, cutStyle: 'classic' }),
        ).not.toThrow();
    });
});
```

Note: legacy Classic (no `classicConfig`) runs `generateProceduralPuzzle`,
which has no topology hook, so the first test passes trivially once the
option exists. It is there to pin that the healthy path stays silent.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/game/init.test.ts`
Expected: FAIL — TypeScript rejects `onPieceCountMismatch` as an unknown property of `InitOptions`.

- [ ] **Step 3: Add the field to `StrategyPuzzle`**

In `src/game/cut-style-strategies.ts`, add to `interface StrategyPuzzle` after `tabDebugReport`:

```ts
    /**
     * Set when the style's generator declared an expected piece count and
     * produced a different one. Styles that `return generateComposablePuzzle(...)`
     * directly get this for free — the topology result already carries it.
     */
    pieceCountMismatch?: PieceCountMismatch;
```

Add the type import at the top of the file:

```ts
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
```

Check whether the file already imports from that module and merge rather than duplicating the import.

- [ ] **Step 4: Add the option and invoke it**

In `src/game/init.ts`, add to `interface InitOptions` after `rotationMode`:

```ts
    /**
     * Called when generation produced a different piece count than the base
     * cut declared (#512). Invoked synchronously during generation, before
     * this function returns — so a caller that wants to report it alongside
     * game state must capture it into a local and act after `createNewGame`
     * returns, when the state exists.
     *
     * Optional: omitting it silently discards the diagnostic, which is the
     * right default for tests and for any caller with nowhere to send it.
     */
    onPieceCountMismatch?: (mismatch: PieceCountMismatch) => void;
```

Add the type import:

```ts
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
```

Change the destructure at line 106 to pick up the new field, and invoke:

```ts
    const { pieces: rawPieces, autoGroups, tabDebugReport, pieceCountMismatch } =
        strategy.generatePieces(generationGrid, puzzleSize, seed, ctx);

    if (pieceCountMismatch) {
        options.onPieceCountMismatch?.(pieceCountMismatch);
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/game/init.test.ts src/game/cut-style-strategies.classic-traced.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. This is the step that proves the additive claim — if any of the 33 existing `createNewGame` call sites broke, it surfaces here.

- [ ] **Step 7: Commit**

```bash
git add src/game/
git commit -m "feat(game): surface piece-count mismatches to createNewGame callers

Carries the topology layer's mismatch through StrategyPuzzle to a new
optional onPieceCountMismatch callback on InitOptions. Purely additive:
callers that omit it are unaffected. Refs #512."
```

---

### Task 3: The analytics event and its payload builder

**Files:**
- Modify: `src/analytics/umami.ts` (add `PieceCountMismatchData` + a `track` overload)
- Modify: `src/analytics/index.ts` (export the type)
- Create: `src/app/piece-count-mismatch-payload.ts`
- Test: `src/app/piece-count-mismatch-payload.test.ts`

**Interfaces:**
- Consumes: `PieceCountMismatch` (Task 1), `buildReproParams` from `src/sharing/index.js`.
- Produces:
  - `PieceCountMismatchData` (the event's 12 properties)
  - `buildPieceCountMismatchData(state: GameState, mismatch: PieceCountMismatch, source: 'fresh' | 'shared' | 'repro'): PieceCountMismatchData`

- [ ] **Step 1: Write the failing test**

Create `src/app/piece-count-mismatch-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { GameState } from '../model/types.js';

function stateFixture(overrides: Partial<GameState> = {}): GameState {
    return {
        seed: 124741785,
        cutStyle: 'classic',
        imageUrl: 'https://images.unsplash.com/photo-123?w=1080&q=80',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 16, rows: 12 },
        rotationMode: 'none',
        classicConfig: { traceSetVersion: 1 },
        pieces: [],
        ...overrides,
    } as unknown as GameState;
}

const MISMATCH = { expected: 192, actual: 189, baseCutId: 'sine' };

describe('buildPieceCountMismatchData', () => {
    it('carries the counts and the base cut that declared them', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.expected).toBe(192);
        expect(data.actual).toBe(189);
        expect(data.baseCut).toBe('sine');
        expect(data.cutStyle).toBe('classic');
        expect(data.source).toBe('fresh');
    });

    it('carries the repro params flattened', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        expect(data.seed).toBe(124741785);
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.imageWidth).toBe(1080);
        expect(data.imageHeight).toBe(720);
        expect(data.rotationMode).toBe('none');
        expect(data.styleConfig).toBe('{"traceSetVersion":1}');
    });

    it('never carries the image URL, under any key', () => {
        const data = buildPieceCountMismatchData(stateFixture(), MISMATCH, 'fresh');
        const serialized = JSON.stringify(data);
        expect(serialized).not.toContain('unsplash');
        expect(serialized).not.toContain('images.unsplash.com');
        expect(Object.keys(data)).not.toContain('imageUrl');
    });

    it('omits styleConfig when the puzzle carries no per-style block', () => {
        const data = buildPieceCountMismatchData(
            stateFixture({ classicConfig: undefined }), MISMATCH, 'fresh');
        expect(data.styleConfig).toBeUndefined();
    });

    it('reports the user grid, not the generation grid', () => {
        // A borderless puzzle generates an oversized grid, but the repro params
        // must be what __reproPuzzle replays from, which is the user grid.
        const data = buildPieceCountMismatchData(
            stateFixture({ gridSize: { cols: 16, rows: 12 } }),
            { expected: 252, actual: 249, baseCutId: 'sine' },
            'fresh',
        );
        expect(data.cols).toBe(16);
        expect(data.rows).toBe(12);
        expect(data.expected).toBe(252);
    });

    it('stays inside Umami event-data limits for every production cut style', () => {
        // Strings <=500 chars, <=50 properties. Numbers carry at most 4
        // decimals. The export shows 102 chars as the longest string shipping
        // today; nothing currently holds that, so this does.
        const styles: Array<Partial<GameState>> = [
            { cutStyle: 'classic', classicConfig: { traceSetVersion: 1 } },
            { cutStyle: 'classic', classicConfig: undefined },
            { cutStyle: 'wavy', wavyConfig: { borderless: true, traceSetVersion: 1 } },
            { cutStyle: 'triangles', trianglesConfig: { traceSetVersion: 1 } },
            { cutStyle: 'fractal', fractalConfig: { borderless: false } },
        ] as unknown as Array<Partial<GameState>>;

        for (const overrides of styles) {
            const data = buildPieceCountMismatchData(
                stateFixture(overrides), MISMATCH, 'fresh');
            expect(Object.keys(data).length).toBeLessThanOrEqual(50);
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    expect(value.length, `${overrides.cutStyle}/${key}`)
                        .toBeLessThanOrEqual(500);
                }
                if (typeof value === 'number') {
                    expect(Number.isFinite(value), `${overrides.cutStyle}/${key}`).toBe(true);
                }
            }
        }
    });

    it('rounds fractional image dimensions to Umami number precision', () => {
        // Inscribed rectangles produce fractional sizes. Umami keeps 4
        // decimals; the share-link decoder floors to whole pixels, so
        // rounding here loses nothing a replay would have kept.
        const data = buildPieceCountMismatchData(
            stateFixture({ imageSize: { width: 1080.123456, height: 719.987654 } }),
            MISMATCH, 'fresh');
        expect(data.imageWidth).toBe(1080.1235);
        expect(data.imageHeight).toBe(719.9877);
    });
});
```

Before running, open `src/model/types.ts` and confirm the `GameState` field
names used above (`seed`, `cutStyle`, `imageUrl`, `imageSize`, `gridSize`,
`rotationMode`, `classicConfig`, `wavyConfig`, `trianglesConfig`,
`fractalConfig`, `composableConfig`). If any differ, fix the fixture — do not
work around it in the implementation. Prefer the shared persistable
game-state fixture if `src/game/` already exports one (commit `652010a`
added one); reuse beats re-declaring.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/piece-count-mismatch-payload.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Add the event type to the analytics schema**

In `src/analytics/umami.ts`, add near the other failure-event interfaces:

```ts
/**
 * Data attached to `piece-count-mismatch` — generation produced a different
 * number of pieces than the base cut declared it would (#512). Three
 * historical fused-piece bugs shipped undetected before this event existed.
 *
 * The event exists to be ACTED on, not just counted: `seed`, `cols`, `rows`,
 * `imageWidth`, `imageHeight`, `rotationMode` and `styleConfig` are exactly
 * the repro params the info modal prints, so a row here can be replayed
 * locally through `__reproPuzzle` and turned into a regression test.
 *
 * `expected` and `actual` are PRE-STRIP, GENERATION-GRID counts, while
 * `cols`/`rows` are the USER grid. For a borderless puzzle these legitimately
 * disagree: a borderless 16x12 oversizes to 18x14 = 252 faces before the outer
 * ring is stripped, so `expected: 252` alongside `cols: 16, rows: 12` is
 * correct, not a contradiction. The user grid is what a replay needs.
 *
 * No `delta` property: it is `actual - expected` and both are here, so the
 * CSV export computes it.
 *
 * `imageUrl` is deliberately absent. Cut geometry is a function of the seed,
 * the grid, the image SIZE, the style and the style config — the image bytes
 * do not enter it, and `reproParamsToPayload` defaults a missing image to the
 * blank canvas, so a replay is geometrically identical without it. It is also
 * the only repro field that could approach Umami's 500-char string limit, and
 * shipping it would be the first exception to the redaction rule
 * {@link TracedChunkLoadFailedData} follows.
 *
 * `source` separates real players from developer investigation: replaying a
 * known-bad puzzle through `__reproPuzzle` re-runs generation and re-fires
 * this event, so `source = 'repro'` rows must be excluded when counting
 * incidents. As everywhere else in this schema, absence cannot be filtered —
 * event properties are key/value rows, so the player-facing population is
 * total `piece-count-mismatch` minus `source = 'repro'`, arithmetic rather
 * than a negated filter (the rule {@link SharedLoadFailedData} documents).
 */
export interface PieceCountMismatchData {
    /** The cut style the player chose. */
    cutStyle: string;
    /**
     * The base-cut generator that declared the expectation — `'sine'` today.
     * NOT derivable from `cutStyle`: classic, wavy, triangles and composable
     * all sit on the sine base cut, so the mismatch is a property of the base
     * cut rather than the style.
     */
    baseCut: string;
    /** Faces the base cut intended to produce. Pre-strip, generation-grid. */
    expected: number;
    /** Faces the pipeline actually yielded. Pre-strip, generation-grid. */
    actual: number;
    /** Repro param: the puzzle's PRNG seed (uint32). */
    seed: number;
    /** Repro param: the USER grid — see the note above. */
    cols: number;
    /** Repro param: the USER grid — see the note above. */
    rows: number;
    /** Repro param: image width. Part of the geometry contract, not decoration. */
    imageWidth: number;
    /** Repro param: image height. Part of the geometry contract, not decoration. */
    imageHeight: number;
    /** Repro param: rotation mode. */
    rotationMode: string;
    /**
     * Repro param: compact JSON of whichever per-style config block the puzzle
     * carries. One property rather than four mutually-exclusive flattened
     * shapes, and exactly what `reproParamsToPayload` needs to rebuild the
     * payload. Absent when the puzzle carries no per-style block (e.g. legacy
     * Classic, whose absence is itself load-bearing — it selects the legacy
     * generator).
     */
    styleConfig?: string;
    /** How the puzzle started. See the note above on excluding `'repro'`. */
    source: 'fresh' | 'shared' | 'repro';
}
```

Add the overload, alongside the others (order matches the existing block; put it after `new-game-failed`):

```ts
export function track(name: 'piece-count-mismatch', data: PieceCountMismatchData): void;
```

Then add `PieceCountMismatchData` to the type exports in `src/analytics/index.ts`.

- [ ] **Step 4: Write the payload builder**

Create `src/app/piece-count-mismatch-payload.ts`:

```ts
/**
 * Build the analytics payload attached to `piece-count-mismatch`.
 *
 * Derives from `buildReproParams` rather than reading `GameState` directly, so
 * the event and the info modal's "Reproduction parameters" block cannot drift
 * apart — a row in Umami is meant to paste straight into `__reproPuzzle`.
 * The one deliberate divergence is `imageUrl`, which is dropped; see
 * `PieceCountMismatchData` for why.
 */

import type { GameState } from '../model/types.js';
import type { PieceCountMismatchData } from '../analytics/index.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { buildReproParams } from '../sharing/index.js';

/**
 * Umami keeps 4 decimal places on numbers. Rounding here rather than letting
 * the tracker do it keeps the value we assert in tests identical to the value
 * that lands in the database.
 */
function toUmamiPrecision(value: number): number {
    return Math.round(value * 10000) / 10000;
}

export function buildPieceCountMismatchData(
    state: GameState,
    mismatch: PieceCountMismatch,
    source: 'fresh' | 'shared' | 'repro',
): PieceCountMismatchData {
    const repro = buildReproParams(state);

    // Exactly one of these is present on any given puzzle; `??` picks it
    // without needing to switch on cutStyle, which would be a fifth
    // hand-maintained per-style touch point (#492).
    const styleConfig =
        repro.classicConfig ??
        repro.wavyConfig ??
        repro.trianglesConfig ??
        repro.fractalConfig ??
        repro.composableConfig;

    // The `?? -1` fallbacks below are unreachable for a generated puzzle —
    // createNewGame always sets seed, gridSize and imageSize — but ReproParams
    // types every field optional because it is also hand-typed from a
    // screenshot. -1 rather than dropping the event: a diagnostic that
    // silently declines to report is worse than one carrying an obviously
    // impossible value, which is visible in the data as a bug in THIS code.
    const data: PieceCountMismatchData = {
        cutStyle: repro.cutStyle ?? 'classic',
        baseCut: mismatch.baseCutId,
        expected: mismatch.expected,
        actual: mismatch.actual,
        seed: repro.seed ?? -1,
        cols: repro.gridSize?.cols ?? -1,
        rows: repro.gridSize?.rows ?? -1,
        imageWidth: toUmamiPrecision(repro.imageSize?.width ?? -1),
        imageHeight: toUmamiPrecision(repro.imageSize?.height ?? -1),
        rotationMode: repro.rotationMode ?? 'none',
        source,
    };

    if (styleConfig !== undefined) {
        data.styleConfig = JSON.stringify(styleConfig);
    }

    return data;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/piece-count-mismatch-payload.test.ts`
Expected: PASS.

If the `styleConfig` test fails on key order, note that `JSON.stringify`
follows insertion order of the config object as `GameState` holds it — assert
on `JSON.parse(data.styleConfig)` instead of the exact string rather than
reordering anything in `GameState`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/analytics/ src/app/piece-count-mismatch-payload.ts src/app/piece-count-mismatch-payload.test.ts
git commit -m "feat(analytics): add the piece-count-mismatch event

Twelve properties: four that answer 'is this happening and how bad', and
the repro params that answer 'which puzzle was it' — the same fields the
info modal prints, so a row can be replayed via __reproPuzzle.

imageUrl is deliberately omitted: geometry does not depend on it, a
replay defaults to the blank canvas, it is the only field that could
approach Umami's 500-char limit, and shipping URLs would break the
redaction convention traced-chunk-load-failed follows. Refs #512."
```

---

### Task 4: Wire both start flows

**Files:**
- Modify: `src/app/start-new-game.ts:268-298`
- Modify: `src/app/load-shared-puzzle.ts:110-115` and its analytics block
- Modify: `src/app/share-payload-to-init.ts:34-53` if the callback is threaded there
- Test: `src/app/start-new-game.test.ts`, `src/app/load-shared-puzzle.test.ts`

**Interfaces:**
- Consumes: `buildPieceCountMismatchData` (Task 3), `InitOptions.onPieceCountMismatch` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

`src/app/start-new-game.test.ts` already has everything needed. Three facts
about that harness, all verified — do not re-derive them:

- It asserts tracking through `umamiTrack`, a `vi.fn()` assigned to
  `window.umami.track` in `beforeEach` (line 106-107). There is no mocked
  `track`; the real one runs and calls through.
- It already wraps `createNewGame` via a `vi.mock('../game/index.js')`
  passthrough, and captures the real implementation as `realCreateNewGame`
  (line 65) precisely so a test can override and `beforeEach` can restore.
- The call signature is `startNewGame(grid, options, deps)` — grid first.
  `noTracedTabsOptions()` is the existing helper for a start that generates
  for real without touching the lazy traced-tab chunk.

Add to `src/app/start-new-game.test.ts`:

```ts
it('reports piece-count-mismatch with repro params when generation flags one', async () => {
    // Drive the callback directly rather than constructing a genuinely
    // broken puzzle: the detector itself is covered in generator.test.ts,
    // and what this test owns is the wiring — that the callback is passed,
    // captured, and reported against the state that createNewGame returned.
    vi.mocked(createNewGame).mockImplementation((imageUrl, imageSize, viewport, grid, options) => {
        options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
        return realCreateNewGame(imageUrl, imageSize, viewport, grid, options);
    });

    await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

    expect(umamiTrack).toHaveBeenCalledWith(
        'piece-count-mismatch',
        expect.objectContaining({
            source: 'fresh',
            expected: 4,
            actual: 2,
            baseCut: 'sine',
            cols: 2,
            rows: 2,
        }),
    );
});

it('never reports the image URL on the mismatch event', async () => {
    vi.mocked(createNewGame).mockImplementation((imageUrl, imageSize, viewport, grid, options) => {
        options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
        return realCreateNewGame(imageUrl, imageSize, viewport, grid, options);
    });

    await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

    const call = umamiTrack.mock.calls.find(([name]) => name === 'piece-count-mismatch');
    expect(JSON.stringify(call?.[1])).not.toContain('http');
});

it('reports nothing for a healthy puzzle', async () => {
    await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
    const names = umamiTrack.mock.calls.map(([name]) => name);
    expect(names).not.toContain('piece-count-mismatch');
});
```

The `mockImplementation` override in the first two tests is exactly the leak
`realCreateNewGame` exists to contain — confirm `beforeEach` restores it (it
does today) before adding tests after these, because this repo's vitest config
has no `restoreMocks` and `clearAllMocks` does not clear implementations.

Add the mirror test to `src/app/load-shared-puzzle.test.ts`, asserting
`source: 'shared'`. Read that file's harness first — it may spy on `track`
differently from this one.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/app/start-new-game.test.ts src/app/load-shared-puzzle.test.ts`
Expected: FAIL — no `piece-count-mismatch` call is ever made.

- [ ] **Step 3: Wire `start-new-game.ts`**

Add the import:

```ts
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
```

Capture during generation — the callback fires while `createNewGame` is still
building the state, so it cannot report directly:

```ts
        let pieceCountMismatch: PieceCountMismatch | undefined;
        const state = createNewGame(imageUrl, imageSize, viewport, oriented, {
            cutStyle,
            composableConfig,
            ...generatorConfigs,
            rotationMode,
            seed,
            onPieceCountMismatch: (m) => { pieceCountMismatch = m; },
        });
```

Then emit after the existing `track('new-game-started', data)` call, so the
normal event still lands first if anything below throws:

```ts
        if (pieceCountMismatch) {
            track(
                'piece-count-mismatch',
                buildPieceCountMismatchData(state, pieceCountMismatch, 'fresh'),
            );
        }
```

- [ ] **Step 4: Wire `load-shared-puzzle.ts`**

Same shape. `createNewGame` there takes `shareInitOptions(payload)`, so spread
it and add the callback at the call site rather than changing
`share-payload-to-init.ts` — that helper maps the wire format onto init
options and a reporting callback is not part of the wire format:

```ts
        let pieceCountMismatch: PieceCountMismatch | undefined;
        const state = createNewGame(
            imageUrl,
            imageSize,
            viewport,
            { cols: payload.g[0], rows: payload.g[1] },
            {
                ...shareInitOptions(payload),
                onPieceCountMismatch: (m) => { pieceCountMismatch = m; },
            },
        );
```

Emit after this flow's own `track('new-game-started', ...)` call with
`'shared'` as the source.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/`
Expected: PASS.

- [ ] **Step 6: Full suite and typecheck**

```bash
npx tsc --noEmit
npm test
```

Expected: all green, including `dcel-broad-phase-equivalence.test.ts` and
`main.test.ts`. Nothing in this task belongs in `main.ts` — if you found
yourself editing it, the change belongs in `bootstrap.ts` or a module it
wires (`CLAUDE.md` § "Keep `main.ts` an entry point").

- [ ] **Step 7: Commit**

```bash
git add src/app/
git commit -m "feat(app): report piece-count mismatches from both start flows

Both createNewGame call sites capture the mismatch during generation and
emit piece-count-mismatch once the state exists, tagged 'fresh' or
'shared'. Closes #512."
```

---

## Deferred: `source: 'repro'`

`PieceCountMismatchData.source` declares `'repro'`, but Task 4 only ever emits
`'fresh'` and `'shared'` — a `__reproPuzzle` replay runs `loadSharedPuzzle` and
reports as `'shared'`.

This is a deliberate, stated gap rather than an oversight, and it is worth
closing in the same PR if the wiring is cheap: `dev-hooks.ts:293` already
passes `source: 'repro'` to `shared-load-failed`, so the discrimination exists
at that layer and needs threading through `loadSharedPuzzle` to reach here.
Check how that existing call obtains the distinction before deciding. If it
needs a new parameter on `loadSharedPuzzle`, do it — the alternative is a
production signal permanently polluted by your own debugging replays, which is
the specific failure this field exists to prevent.

If it is left open, say so in the PR description and file a follow-up. Do not
quietly ship a `source` union with an unreachable member.

## Verification before opening the PR

- [ ] `npm test` green, including the DCEL digest test (never re-recorded).
- [ ] `npx tsc --noEmit` clean.
- [ ] `grep -rn "imageUrl" src/app/piece-count-mismatch-payload.ts` returns only the comment explaining the omission.
- [ ] Manual check: in a dev build, force a mismatch (register the fake generator via the console or temporarily hard-code one), start a game, and confirm the console warning appears and a `piece-count-mismatch` event is sent with the repro params.
- [ ] Paste the emitted params into `__reproPuzzle` and confirm the puzzle regenerates — that round trip is the whole point of the feature, and it is the one thing no unit test proves.
- [ ] PR body opens with `Closes #512`.
