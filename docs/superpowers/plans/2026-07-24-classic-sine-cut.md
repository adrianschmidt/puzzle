# Classic Sine-Based Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Classic cut style to a gentle sine-based cut with traced tabs and free rotation, while every existing Classic share link keeps reproducing with the old generator.

**Architecture:** New Classic reuses the composable pipeline (like Wavy/Triangles) with hard-coded sine params (`ha=va=0.11`, `hf=cols/3`, `vf=rows/3`) and traced tabs. A new per-style config `classicConfig: { traceSetVersion?: number }` — surfaced on the share payload as `clf: { tv }` — is the discriminator: present ⇒ new pipeline; absent ⇒ today's `generateProceduralPuzzle`, untouched.

**Tech Stack:** TypeScript, Vite, Vitest.

## Global Constraints

- Programming in American English (identifiers, comments).
- **Reproducibility contract:** never change the PRNG call count/order of `generateProceduralPuzzle`; the legacy path stays byte-for-byte identical. A `clf`-less `c:'classic'` payload MUST reproduce the old pieces.
- Sine params are hard-coded in the strategy, NOT written to the wire (mirrors Wavy) — no new `MAX_SINE_*` clamp surface.
- New Classic config shape: `{ traceSetVersion?: number }` (borderless is always `false`; no new-game dialog option).
- `CURRENT_TRACE_SET_VERSION` is imported from `./puzzle/composable/traces/trace-set-version.js` (value currently `1`).
- No `STATE_VERSION` bump: `classicConfig` is an additive optional field (follows the `selection`/`viewport` precedent).
- Run the full suite with `npm test` and typecheck via `npm run build` (or `npx tsc --noEmit`).

---

### Task 1: Flip Classic to free rotation + description copy

**Files:**
- Modify: `src/game/cut-styles.ts:38-43` (classic option) 
- Test: `src/game/cut-styles.test.ts:164-172`

**Interfaces:**
- Produces: `CUT_STYLE_OPTIONS` classic entry now has `rotation: 'free'`; `rotationModeForNewGame('classic', true) === 'free'`.

- [ ] **Step 1: Update the failing test**

In `src/game/cut-styles.test.ts`, change the `rotationModeForNewGame` cases so classic is free:

```ts
    it('returns quarter-turn for fractal', () => {
        expect(rotationModeForNewGame('fractal', true)).toBe('quarter-turn');
    });

    it('returns free for classic, wavy, triangles, and composable', () => {
        expect(rotationModeForNewGame('classic', true)).toBe('free');
        expect(rotationModeForNewGame('wavy', true)).toBe('free');
        expect(rotationModeForNewGame('triangles', true)).toBe('free');
        expect(rotationModeForNewGame('composable', true)).toBe('free');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/cut-styles.test.ts`
Expected: FAIL — classic still returns `'quarter-turn'`.

- [ ] **Step 3: Update the classic option**

In `src/game/cut-styles.ts`, the classic entry becomes:

```ts
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional jigsaw pieces',
        rotation: 'free',
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/cut-styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/cut-styles.ts src/game/cut-styles.test.ts
git commit -m "feat: Classic cut style rotates freely"
```

---

### Task 2: `classicConfig` type + strategy generation branch

**Files:**
- Modify: `src/model/types.ts:228-237` (add `classicConfig` after `trianglesConfig`)
- Modify: `src/game/cut-style-strategies.ts:46-58` (`StrategyContext`), `:100` (`configKey` union), `:103-109` (`classicStrategy`)
- Modify: `src/game/init.ts:44-67` (`InitOptions`), `:91-97` (ctx), `:130-133` (returned state)
- Test: `src/game/cut-style-strategies.test.ts` (new file)

**Interfaces:**
- Consumes: `generateProceduralPuzzle(cols, rows, size, seed)` and `generateComposablePuzzle(cols, rows, size, seed, config)` (both already imported in `cut-style-strategies.ts`).
- Produces: `GameState.classicConfig?: { traceSetVersion?: number }`; `InitOptions.classicConfig?: { traceSetVersion?: number }`; `StrategyContext.classicConfig?: { traceSetVersion?: number }`; `classicStrategy.configKey === 'classicConfig'`. When `classicConfig.traceSetVersion` is set the strategy generates via `generateComposablePuzzle` with `baseCutGenerator:'sine'`, `baseCutConfig:{cols,rows,ha:0.11,hf:cols/3,va:0.11,vf:rows/3}`, `tabGenerator:'traced'`, `tabConfig:{traceSetVersion}`, `minPieceArea:avgPieceArea/4`, `borderless:false`.

- [ ] **Step 1: Write the failing test**

Create `src/game/cut-style-strategies.test.ts`. The composable generator is mocked as a pure spy so the test asserts the exact config without running traced generation; the legacy generator is left real so the fallback path is verified against its true output.

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../puzzle/composable-generator.js', () => ({
    generateComposablePuzzle: vi.fn(() => ({ pieces: [] })),
}));

import { getCutStyleStrategy } from './cut-style-strategies.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';

const mockComposable = vi.mocked(generateComposablePuzzle);

describe('classicStrategy', () => {
    it('uses the sine pipeline with gentle params when classicConfig is set', () => {
        mockComposable.mockClear();
        const strategy = getCutStyleStrategy('classic');
        strategy.generatePieces(
            { cols: 6, rows: 3 },
            { width: 600, height: 300 },
            123,
            { classicConfig: { traceSetVersion: 1 } },
        );
        expect(mockComposable).toHaveBeenCalledWith(
            6, 3, { width: 600, height: 300 }, 123,
            expect.objectContaining({
                baseCutGenerator: 'sine',
                baseCutConfig: expect.objectContaining({
                    cols: 6, rows: 3, ha: 0.11, hf: 2, va: 0.11, vf: 1,
                }),
                tabGenerator: 'traced',
                tabConfig: { traceSetVersion: 1 },
                borderless: false,
            }),
        );
    });

    it('falls back to the legacy generator when classicConfig is absent', () => {
        mockComposable.mockClear();
        const strategy = getCutStyleStrategy('classic');
        const result = strategy.generatePieces(
            { cols: 3, rows: 2 }, { width: 300, height: 200 }, 7, {},
        );
        expect(mockComposable).not.toHaveBeenCalled();
        const legacy = generateProceduralPuzzle(3, 2, { width: 300, height: 200 }, 7);
        expect(result.pieces.map((p) => p.shape)).toEqual(legacy.map((p) => p.shape));
    });

    it('exposes classicConfig as its configKey', () => {
        expect(getCutStyleStrategy('classic').configKey).toBe('classicConfig');
    });
});
```

(`hf = 6/3 = 2`, `vf = 3/3 = 1`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/cut-style-strategies.test.ts`
Expected: FAIL — `classicStrategy` still ignores config and has no `configKey`.

- [ ] **Step 3: Add the `classicConfig` type to `GameState`**

In `src/model/types.ts`, immediately after the `trianglesConfig` field (before the closing `}` at line 237):

```ts
    /**
     * Classic-cut config (only set when cutStyle === 'classic' AND the
     * puzzle was generated with the sine-based Classic generator).
     *
     * Its presence is the generator discriminator: a Classic puzzle WITH a
     * traceSetVersion reproduces via the composable sine pipeline; a Classic
     * puzzle WITHOUT one (every pre-upgrade share link/save) reproduces via
     * the legacy generateProceduralPuzzle. See project_share_link_prng_contract.
     */
    classicConfig?: {
        /** Trace-set version for the hand-traced tab shapes. */
        traceSetVersion?: number;
    };
```

- [ ] **Step 4: Extend `StrategyContext`, the `configKey` union, and `classicStrategy`**

In `src/game/cut-style-strategies.ts`, add to `StrategyContext` (after the `trianglesConfig` line ~50):

```ts
    classicConfig?: { traceSetVersion?: number };
```

Extend the `configKey` union (line ~100):

```ts
    configKey?: 'fractalConfig' | 'composableConfig' | 'wavyConfig' | 'trianglesConfig' | 'classicConfig';
```

Replace `classicStrategy` (lines 103-109) with:

```ts
const classicStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) => {
        const traceSetVersion = ctx.classicConfig?.traceSetVersion;
        if (traceSetVersion === undefined) {
            // Legacy Classic: every pre-upgrade share link/save. The PRNG
            // call count/order of generateProceduralPuzzle is a wire contract
            // — do not touch it. See project_share_link_prng_contract.
            return {
                pieces: generateProceduralPuzzle(grid.cols, grid.rows, puzzleSize, seed),
            };
        }
        // Sine-based Classic: a gentle Wavy. Params are fixed here (not on the
        // wire), so Classic links carry no attacker-controllable sine config.
        const avgPieceArea =
            (puzzleSize.width * puzzleSize.height) / (grid.cols * grid.rows);
        return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: {
                cols: grid.cols,
                rows: grid.rows,
                ha: 0.11,
                hf: grid.cols / 3,
                va: 0.11,
                vf: grid.rows / 3,
            },
            tabGenerator: 'traced',
            tabConfig: { traceSetVersion },
            minPieceArea: avgPieceArea / 4,
            borderless: false,
            tabDebug: ctx.tabDebug,
        });
    },
    configKey: 'classicConfig',
};
```

- [ ] **Step 5: Thread `classicConfig` through `init.ts`**

In `src/game/init.ts`, add to `InitOptions` (after the `wavyConfig`/`trianglesConfig` fields ~58):

```ts
    /** Configuration for the sine-based Classic generator (only used when cutStyle is 'classic'). */
    classicConfig?: { traceSetVersion?: number };
```

Add to the `ctx` object in `createNewGame` (after `trianglesConfig: options.trianglesConfig,` ~95):

```ts
        classicConfig: options.classicConfig,
```

Add to the returned `GameState` (after the `trianglesConfig:` line ~133):

```ts
        classicConfig: strategy.configKey === 'classicConfig' ? options.classicConfig : undefined,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/game/cut-style-strategies.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/model/types.ts src/game/cut-style-strategies.ts src/game/init.ts src/game/cut-style-strategies.test.ts
git commit -m "feat: sine-based Classic generator behind classicConfig discriminator"
```

---

### Task 3: Serialize `classicConfig`

**Files:**
- Modify: `src/persistence/serialization.ts` — `SerializedGameState` (~94), `SerializedStaticState` (~131), `serializeState` (~243), `serializeStatic` (~266), `deserializeState` (~364), `recombine` (~428)
- Test: `src/persistence/serialization.test.ts:257-272` (add classic cases after the triangles ones)

**Interfaces:**
- Consumes: `GameState.classicConfig` (Task 2).
- Produces: `classicConfig` round-trips through `serializeState`/`deserializeState` and `serializeStatic`/`recombine`.

- [ ] **Step 1: Write the failing tests**

In `src/persistence/serialization.test.ts`, after the trianglesConfig round-trip tests (~272), add:

```ts
    it('round-trips classicConfig through serializeState/deserializeState', () => {
        const restored = deserializeState(serializeState(makeGameState({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 1 },
        })));
        expect(restored.classicConfig).toEqual({ traceSetVersion: 1 });
    });

    it('round-trips classicConfig through serializeStatic/recombine', () => {
        const state = makeGameState({
            cutStyle: 'classic',
            classicConfig: { traceSetVersion: 1 },
        });
        const restored = recombine(serializeStatic(state), serializeProgress(state));
        expect(restored.classicConfig).toEqual({ traceSetVersion: 1 });
    });

    it('leaves classicConfig undefined for a legacy classic save', () => {
        const restored = deserializeState(serializeState(makeGameState({
            cutStyle: 'classic',
        })));
        expect(restored.classicConfig).toBeUndefined();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: FAIL — `restored.classicConfig` is undefined for the first two cases.

- [ ] **Step 3: Add the field to the serialized shapes**

In `SerializedGameState`, after the `trianglesConfig` field (~94):

```ts
    /** Classic-cut config (only set when cutStyle === 'classic' with the sine generator). */
    classicConfig?: GameState['classicConfig'];
```

In `SerializedStaticState`, after its `trianglesConfig` field (~131):

```ts
    classicConfig?: GameState['classicConfig'];
```

- [ ] **Step 4: Write and read the field**

In `serializeState`, after the `trianglesConfig` block (~245):

```ts
    if (state.classicConfig) {
        serialized.classicConfig = state.classicConfig;
    }
```

In `serializeStatic`, after the `trianglesConfig` line (~266):

```ts
    if (state.classicConfig) s.classicConfig = state.classicConfig;
```

In `deserializeState`, after the `trianglesConfig` block (~366):

```ts
    if (data.classicConfig) {
        state.classicConfig = data.classicConfig;
    }
```

In `recombine`, after the `trianglesConfig` line (~428):

```ts
    if (staticData.classicConfig) state.classicConfig = staticData.classicConfig;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat: persist classicConfig in saves"
```

---

### Task 4: Share-link `clf` codec

**Files:**
- Modify: `src/sharing/share-link.ts` — `SharePayload` (~69), `assertPayloadNumbersFinite` (~105), `decodePayload` (~225), `gameStateToPayload` (~500)
- Test: `src/sharing/share-link.test.ts` (add a `clf` describe block, mirroring the triangles `tf` block at ~1350; reuse the file's existing `buildState` and `encodeRaw` helpers)

**Interfaces:**
- Consumes: `GameState.classicConfig` (Task 2); `clampTraceSetVersion` and `CURRENT_TRACE_SET_VERSION` (already in `share-link.ts`).
- Produces: `SharePayload.clf?: { tv: number }`. `gameStateToPayload` emits `clf` when `state.classicConfig?.traceSetVersion !== undefined`; `decodePayload` clamps `clf.tv` to `CURRENT_TRACE_SET_VERSION` and drops `clf` on an invalid `tv` (→ legacy generator).

- [ ] **Step 1: Write the failing tests**

In `src/sharing/share-link.test.ts`, add after the triangles `tf` describe block (~1408):

```ts
describe('share-link classic traceSetVersion (clf)', () => {
    function classicState(traceSetVersion?: number): GameState {
        return buildState({
            cutStyle: 'classic',
            classicConfig: traceSetVersion === undefined ? {} : { traceSetVersion },
        });
    }

    it('encodes clf.tv from the classic config', () => {
        const payload = gameStateToPayload(classicState(1), { includeProgress: false });
        expect(payload.c).toBe('classic');
        expect(payload.clf).toEqual({ tv: 1 });
    });

    it('omits clf for a legacy classic puzzle', () => {
        const payload = gameStateToPayload(classicState(undefined), { includeProgress: false });
        expect(payload.clf).toBeUndefined();
    });

    it('round-trips clf.tv through encode/decode', () => {
        const payload = gameStateToPayload(classicState(1), { includeProgress: false });
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded!.c).toBe('classic');
        expect(decoded!.clf).toEqual({ tv: 1 });
    });

    it('accepts a legacy classic payload without clf', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'classic', s: 1, r: 'none',
        }));
        expect(decoded).not.toBeNull();
        expect(decoded!.clf).toBeUndefined();
    });

    it('clamps a future tv down to the newest known version', () => {
        const decoded = decodePayload(encodeRaw({
            v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'classic', s: 1, r: 'free',
            clf: { tv: 999 },
        }));
        expect(decoded!.clf!.tv).toBe(CURRENT_TRACE_SET_VERSION);
    });

    it('drops the clf block entirely on an invalid tv (→ legacy generator)', () => {
        for (const bad of [0, -3, 'x', null] as unknown[]) {
            const decoded = decodePayload(encodeRaw({
                v: 1, i: 'blank', is: [1080, 720], g: [8, 6], c: 'classic', s: 1, r: 'free',
                clf: { tv: bad },
            }));
            expect(decoded).not.toBeNull();
            expect(decoded!.clf).toBeUndefined();
        }
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — `payload.clf` is undefined / type error on unknown property.

- [ ] **Step 3: Add `clf` to the payload type**

In `src/sharing/share-link.ts`, after the `tf` field in `SharePayload` (~69):

```ts
    /**
     * Classic-cut config. `tv` = trace-set version. Its PRESENCE selects the
     * sine-based Classic generator; ABSENCE (every pre-upgrade link) selects
     * the legacy generateProceduralPuzzle. Unlike triangles' `tf`, an invalid
     * `tv` drops the whole block and falls back to the legacy generator.
     */
    clf?: { tv: number };
```

- [ ] **Step 4: Finite-check `clf.tv` on encode**

In `assertPayloadNumbersFinite`, after the `tf` check (~107):

```ts
    if (payload.c === 'classic' && payload.clf?.tv !== undefined) {
        check(payload.clf.tv, 'clf.tv');
    }
```

- [ ] **Step 5: Clamp/drop `clf` on decode**

In `decodePayload`, after the triangles `tf` block (~235):

```ts
        if (translated.c === 'classic' && translated.clf) {
            const clamped = clampTraceSetVersion(translated.clf.tv);
            // An invalid tv drops the block, so the puzzle reproduces with the
            // legacy generator (contrast triangles, which keeps the composable
            // pipeline and substitutes the current trace set).
            if (clamped === undefined) {
                delete translated.clf;
            } else {
                translated.clf.tv = clamped;
            }
        }
```

- [ ] **Step 6: Emit `clf` in `gameStateToPayload`**

In `gameStateToPayload`, after the `triangles` block (~502):

```ts
    if (cutStyle === 'classic' && state.classicConfig?.traceSetVersion !== undefined) {
        payload.clf = { tv: state.classicConfig.traceSetVersion };
    }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat: encode Classic sine generator as clf on share links"
```

---

### Task 5: Wire the app entry (`main.ts`)

**Files:**
- Modify: `src/main.ts` — `startNewGame` traced-preload condition (~924), classic config stamping (~1012) and pass-through (~1024); `loadSharedPuzzle` traced-preload condition (~1349), config pass-through (~1385), analytics stamp (~1454)

**Interfaces:**
- Consumes: `CURRENT_TRACE_SET_VERSION` (already imported ~118), `preloadTracedTabGenerator` (already imported ~117), `SharePayload.clf` (Task 4), `InitOptions.classicConfig` (Task 2).
- Produces: new Classic games carry `classicConfig: { traceSetVersion: CURRENT_TRACE_SET_VERSION }`; `clf`-bearing links reconstruct it; the traced chunk is preloaded on both paths; `NewGameData.traceSetVersion` is stamped for Classic.

- [ ] **Step 1: Preload the traced chunk for new Classic games**

In `startNewGame`, extend the preload condition (~924) to include classic (every new Classic game uses traced tabs):

```ts
        if (composableConfig?.tabGenerator === 'traced' || cutStyle === 'wavy'
            || cutStyle === 'triangles' || cutStyle === 'classic') {
            await preloadTracedTabGenerator();
        }
```

- [ ] **Step 2: Stamp and pass `classicConfig` for new games**

In `startNewGame`, after the `generatorTrianglesConfig` block (~1014):

```ts
        // Every new Classic game uses the sine-based generator with traced tabs
        // at the current trace-set version — same stamping rationale as
        // generatorWavyConfig. A Classic game without this config would fall
        // back to the legacy generator, so stamping it is what activates the
        // upgrade for fresh puzzles.
        const generatorClassicConfig = cutStyle === 'classic'
            ? { traceSetVersion: CURRENT_TRACE_SET_VERSION }
            : undefined;
```

Add it to the `createNewGame` options object (after `trianglesConfig: generatorTrianglesConfig,` ~1024):

```ts
            classicConfig: generatorClassicConfig,
```

- [ ] **Step 3: Preload + reconstruct `classicConfig` on the share-load path**

In `loadSharedPuzzle`, extend the preload condition (~1349):

```ts
        if (payload.cf?.tg === 'traced'
            || (payload.c === 'wavy' && payload.wf?.tv !== undefined)
            || payload.c === 'triangles'
            || (payload.c === 'classic' && payload.clf !== undefined)) {
            await preloadTracedTabGenerator();
        }
```

Add to the `createNewGame` options in `loadSharedPuzzle` (after the `trianglesConfig:` block ~1387):

```ts
            classicConfig: payload.clf
                ? { traceSetVersion: payload.clf.tv }
                : undefined,
```

- [ ] **Step 4: Stamp Classic trace-set version into analytics**

In `loadSharedPuzzle`, after the triangles analytics stamp (~1456):

```ts
        if (payload.c === 'classic' && payload.clf?.tv !== undefined) {
            data.traceSetVersion = payload.clf.tv;
        }
```

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Then:
1. New game → Classic → confirm cuts are gently wavy (not straight) and tabs render (traced).
2. Enable rotation for a Classic game → confirm the continuous dial (not the ↺/↻ quarter-turn buttons) appears.
3. Share the Classic puzzle, open the link in a fresh tab → confirm identical pieces.
4. Open a pre-existing Classic link if you have one (or a `#p=` payload with `c:'classic'` and no `clf`) → confirm it still loads straight-grid classic pieces.

Expected: all four hold.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: activate sine-based Classic on new-game and share-load paths"
```

---

### Task 6: Fix the info-modal rotation copy

**Files:**
- Modify: `src/ui/info-modal.ts:157-167`
- Test: `src/ui/info-modal.test.ts:235-254`

**Interfaces:**
- Produces: the How-to-Play rotation copy attributes 90° rotation to Fractal only and free rotation to Classic, Wavy, and Triangles.

- [ ] **Step 1: Update the failing tests**

In `src/ui/info-modal.test.ts`, replace the `attributes 90° rotation to Classic and Fractal` test (~246-254) and augment the free-rotation test:

```ts
    it('mentions Wavy and Classic alongside Free rotation', () => {
        createInfoModal({ container });
        const text = howToPlaySection().textContent ?? '';
        const freeRotIdx = text.indexOf('Free rotation');
        expect(freeRotIdx).toBeGreaterThan(-1);
        const context = text.slice(freeRotIdx, freeRotIdx + 60);
        expect(context).toContain('Classic');
        expect(context).toContain('Wavy');
    });

    it('attributes 90° rotation to Fractal only', () => {
        createInfoModal({ container });
        const text = howToPlaySection().textContent ?? '';
        const ninetyIdx = text.indexOf('90° rotation');
        expect(ninetyIdx).toBeGreaterThan(-1);
        const context = text.slice(ninetyIdx, ninetyIdx + 40);
        expect(context).toContain('Fractal');
        expect(context).not.toContain('Classic');
    });
```

(Replace the old `mentions Wavy alongside Free rotation` test at ~235 with the first block above.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: FAIL — the copy still says "(Classic and Fractal puzzles)".

- [ ] **Step 3: Update the copy**

In `src/ui/info-modal.ts`, the rotate list item (lines 160-167) becomes:

```ts
        ' (when rotation is enabled) — Tap any piece to bring up rotation controls next to it. With ',
        ['strong', '90° rotation'],
        ' (Fractal puzzles), the ↺ / ↻ buttons rotate the focused piece by a quarter-turn. With ',
        ['strong', 'Free rotation'],
        " (Classic, Wavy and Triangles puzzles), a single round handle below the focused piece lets you drag to rotate continuously — the piece follows your finger like a dial. Pieces snap together when their rotations are close to alignment; how close they need to be depends on your ",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "docs: info-modal rotation copy — Classic now rotates freely"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full suite + typecheck + lint + build**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass. (If a lint script exists, run it too.)

- [ ] **Step 2: Confirm no unintended snapshot churn**

Run: `git status` and review. Any regenerated snapshots under `src/puzzle/topology/__snapshots__/` must be inspected — a change there would signal the legacy generator's PRNG contract shifted, which MUST NOT happen. If any legacy-classic snapshot changed, stop and investigate.

Expected: no legacy-classic snapshot changes.

---

## Self-Review notes

- **Spec coverage:** discriminator (Task 4), config shape + strategy (Task 2), rotation flip (Task 1), serialization no-bump (Task 3), main.ts wiring + preload + analytics (Task 5), info-modal copy (Task 6), reproduction guard (Task 2 fallback test + Task 7 snapshot check). Description copy → Task 1. All spec sections mapped.
- **Type consistency:** `classicConfig: { traceSetVersion?: number }` and `clf: { tv: number }` used identically across Tasks 2–5.
- **No global `v` bump / no `STATE_VERSION` bump:** intentional, per Global Constraints.
