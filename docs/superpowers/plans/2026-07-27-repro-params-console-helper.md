# Repro Params Image Fields + Console Replay Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The info modal's "Reproduction parameters" block gains `imageUrl` + `imageSize` (geometry inscribes to the image, so dimensions are part of the reproduction contract), and a new dev-console helper `__reproPuzzle(params)` replays the block's exact JSON through the share-link validation and load path.

**Architecture:** A new shared module `src/sharing/repro-params.ts` owns the JSON contract: `buildReproParams(state)` (moved from `info-modal.ts`, plus the two fields) and `reproParamsToPayload(params)` (maps to `SharePayload`, throwing on missing required fields). The five per-style config blocks are extracted from `gameStateToPayload` into a shared `applyStyleConfigs` in `share-link.ts` so the mapping exists once. `main.ts` wires `window.__reproPuzzle` as thin glue: params → payload → `decodePayload(encodePayload(...))` (reuses all codec validation/clamps) → `clearSavedState()` → `loadSharedPuzzle`.

**Tech Stack:** TypeScript, Vitest (`npm test`; typecheck `npx tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-07-27-repro-params-console-helper-design.md`

## Global Constraints

- **Share links must not change:** the `applyStyleConfigs` extraction is a pure refactor of `gameStateToPayload` — emitted payloads must be deep-equal to today's for every state. Existing share-link tests must pass unmodified.
- `__newComposableGame` stays untouched.
- No new analytics events (dev-only surface). No player-visible behavior change beyond the debug-panel block content/description.
- American English; conventional commits, no scopes; no AI attribution or conversation references in messages.
- After each task: `npx tsc --noEmit` clean and `npm test` green before committing.
- Test files live next to the source they test.

## File Structure

- `src/sharing/repro-params.ts` (new) — `ReproParams`, `buildReproParams`, `reproParamsToPayload`.
- `src/sharing/repro-params.test.ts` (new).
- `src/sharing/share-link.ts` — extract `applyStyleConfigs(payload, source)` from `gameStateToPayload` (lines ~491-530), export it plus a `StyleConfigSource` interface.
- `src/ui/info-modal.ts` — delete local `buildReproParams` (lines ~64-84), import from the new module; extend the block's description sentence.
- `src/ui/info-modal.test.ts` — extend block-content assertions with the two new fields.
- `src/main.ts` — add `window.__reproPuzzle` next to `__newComposableGame`.

---

### Task 1: `repro-params` module, `applyStyleConfigs` extraction, modal swap

**Files:**
- Create: `src/sharing/repro-params.ts`
- Create: `src/sharing/repro-params.test.ts`
- Modify: `src/sharing/share-link.ts` (extract from `gameStateToPayload`, `share-link.ts:462-540`)
- Modify: `src/ui/info-modal.ts:64-84` (delete local builder, import), `:544-546` (description)
- Modify: `src/ui/info-modal.test.ts` (block content assertions)

**Interfaces:**
- Consumes: `SharePayload`, `encodePayload`, `decodePayload`, `gameStateToPayload` from `./share-link.js`; `GameState` from `../model/types.js`; `makeGameState` from `../test-helpers/fixtures.js` (adapt override names to that fixture's actual API when writing tests).
- Produces (Task 2 depends on these exact names):
  - `interface ReproParams` and `interface StyleConfigSource` (ReproParams extends it)
  - `buildReproParams(state: GameState): ReproParams`
  - `reproParamsToPayload(params: ReproParams): SharePayload` (throws `Error` naming the missing field)
  - `applyStyleConfigs(payload: SharePayload, source: StyleConfigSource): void` exported from `share-link.ts`

- [ ] **Step 1: Write the failing tests**

`src/sharing/repro-params.test.ts` — adapt state construction to the `makeGameState` fixture API; the assertions are the contract:

```ts
import { describe, expect, it } from 'vitest';
import { buildReproParams, reproParamsToPayload } from './repro-params.js';
import { decodePayload, encodePayload } from './share-link.js';
import { makeGameState } from '../test-helpers/fixtures.js';

function classicTracedState() {
    const state = makeGameState();
    state.seed = 1534700170;
    state.cutStyle = 'classic';
    state.imageUrl = 'https://images.unsplash.com/photo-x?w=1080';
    state.imageSize = { width: 1080, height: 1440 };
    state.gridSize = { cols: 12, rows: 16 };
    state.rotationMode = 'free';
    state.classicConfig = { traceSetVersion: 1 };
    return state;
}

describe('buildReproParams', () => {
    it('includes imageUrl and imageSize', () => {
        const params = buildReproParams(classicTracedState());
        expect(params.imageUrl).toBe('https://images.unsplash.com/photo-x?w=1080');
        expect(params.imageSize).toEqual({ width: 1080, height: 1440 });
    });

    it('passes classicConfig through and omits other styles’ configs', () => {
        const params = buildReproParams(classicTracedState());
        expect(params.classicConfig).toEqual({ traceSetVersion: 1 });
        expect(params).not.toHaveProperty('wavyConfig');
        expect(params).not.toHaveProperty('composableConfig');
    });

    it('omits classicConfig for a legacy-classic state', () => {
        const state = classicTracedState();
        delete state.classicConfig;
        expect(buildReproParams(state)).not.toHaveProperty('classicConfig');
    });
});

describe('reproParamsToPayload', () => {
    it('maps a classic-traced params object', () => {
        const payload = reproParamsToPayload(buildReproParams(classicTracedState()));
        expect(payload).toEqual({
            v: 1,
            i: 'https://images.unsplash.com/photo-x?w=1080',
            is: [1080, 1440],
            g: [12, 16],
            c: 'classic',
            s: 1534700170,
            r: 'free',
            clf: { tv: 1 },
        });
    });

    it('omits clf when classicConfig is absent (legacy generator semantics)', () => {
        const params = buildReproParams(classicTracedState());
        delete params.classicConfig;
        expect(reproParamsToPayload(params)).not.toHaveProperty('clf');
    });

    it('falls back to the blank canvas and no rotation', () => {
        const params = buildReproParams(classicTracedState());
        delete params.imageUrl;
        delete params.rotationMode;
        const payload = reproParamsToPayload(params);
        expect(payload.i).toBe('blank');
        expect(payload.r).toBe('none');
    });

    it('maps wavy config', () => {
        const state = classicTracedState();
        state.cutStyle = 'wavy';
        delete state.classicConfig;
        state.wavyConfig = { borderless: true, traceSetVersion: 1 };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.wf).toEqual({ bl: true, tv: 1 });
        expect(payload).not.toHaveProperty('clf');
    });

    it('maps composable config through the shared block mapping', () => {
        const state = classicTracedState();
        state.cutStyle = 'composable';
        delete state.classicConfig;
        state.composableConfig = {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.4 },
            tabGenerator: 'classic',
            tabConfig: {},
            minPieceArea: 500,
        };
        const payload = reproParamsToPayload(buildReproParams(state));
        expect(payload.cf).toEqual({
            bg: 'sine', bgc: { ha: 0.4 }, tg: 'classic', tgc: {}, mpa: 500,
        });
    });

    for (const field of ['seed', 'cutStyle', 'imageSize', 'gridSize'] as const) {
        it(`throws naming the missing field: ${field}`, () => {
            const params = buildReproParams(classicTracedState());
            delete params[field];
            expect(() => reproParamsToPayload(params)).toThrow(field);
        });
    }

    it('survives the share codec round-trip the console helper uses', () => {
        const payload = reproParamsToPayload(buildReproParams(classicTracedState()));
        const decoded = decodePayload(encodePayload(payload));
        expect(decoded).not.toBeNull();
        expect(decoded).toMatchObject({ s: 1534700170, c: 'classic', is: [1080, 1440], clf: { tv: 1 } });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sharing/repro-params.test.ts`
Expected: FAIL — module `./repro-params.js` not found.

- [ ] **Step 3: Extract `applyStyleConfigs` in `share-link.ts`**

Directly above `gameStateToPayload`, add — the five blocks are MOVED verbatim from `gameStateToPayload:491-530` with `state` renamed to `source` and `cutStyle` read from `payload.c`:

```ts
/**
 * The five per-style config fields a repro-params object shares with
 * GameState. `applyStyleConfigs` reads whichever one matches the
 * payload's cut style; the rest are ignored.
 */
export interface StyleConfigSource {
    composableConfig?: GameState['composableConfig'];
    fractalConfig?: GameState['fractalConfig'];
    wavyConfig?: GameState['wavyConfig'];
    trianglesConfig?: GameState['trianglesConfig'];
    classicConfig?: GameState['classicConfig'];
}

/**
 * Copy the config block matching `payload.c` from `source` onto the
 * payload. Shared between `gameStateToPayload` (share links) and
 * `reproParamsToPayload` (the `__reproPuzzle` console helper) so the
 * style-block wire mapping exists once.
 */
export function applyStyleConfigs(payload: SharePayload, source: StyleConfigSource): void {
    /* the five `if (cutStyle === '...')` blocks moved verbatim,
       with `cutStyle` replaced by `payload.c` and `state` by `source` */
}
```

In `gameStateToPayload`, replace the five blocks with `applyStyleConfigs(payload, state);` (placed exactly where the first block was, before the `options.includeProgress` handling, so field insertion order — and thus encoded JSON — is unchanged for every existing test).

- [ ] **Step 4: Create `src/sharing/repro-params.ts`**

```ts
/**
 * The info modal's "Reproduction parameters" block and the
 * `__reproPuzzle` console helper share this contract: the modal prints
 * a `ReproParams` as JSON, and the helper accepts that exact object.
 *
 * `imageSize` is part of the reproduction contract, not decoration:
 * generators inscribe the puzzle into the image rectangle, so the same
 * seed/grid/style cuts differently at different image dimensions.
 * `imageUrl` makes the repro visually exact; every value the app stores
 * is portable (an Unsplash https URL, a bundled asset path, or the
 * `'blank'` canvas sentinel).
 */

import type { GameState } from '../model/types.js';
import type { SharePayload, StyleConfigSource } from './share-link.js';
import { applyStyleConfigs } from './share-link.js';

export interface ReproParams extends StyleConfigSource {
    seed?: number;
    cutStyle?: string;
    imageUrl?: string;
    imageSize?: { width: number; height: number };
    gridSize?: { cols: number; rows: number };
    rotationMode?: 'none' | 'quarter-turn' | 'free';
}

/**
 * Fields required to reproduce a puzzle from its seed.
 * Kept minimal so a screenshot of the block is easy to read.
 */
export function buildReproParams(state: GameState): ReproParams {
    const params: ReproParams = {};
    if (state.seed !== undefined) params.seed = state.seed;
    if (state.cutStyle) params.cutStyle = state.cutStyle;
    params.imageUrl = state.imageUrl;
    params.imageSize = state.imageSize;
    if (state.gridSize) params.gridSize = state.gridSize;
    if (state.rotationMode) params.rotationMode = state.rotationMode;
    if (state.composableConfig) params.composableConfig = state.composableConfig;
    if (state.fractalConfig) params.fractalConfig = state.fractalConfig;
    if (state.wavyConfig) params.wavyConfig = state.wavyConfig;
    if (state.trianglesConfig) params.trianglesConfig = state.trianglesConfig;
    // Load-bearing for Classic: its presence is what selects the sine
    // generator over the legacy one, so omitting it would make the block
    // describe a different puzzle than the one on screen.
    if (state.classicConfig) params.classicConfig = state.classicConfig;
    return params;
}

/**
 * Map a repro-params object onto the share-link wire format.
 *
 * Throws (naming the field) when a required field is missing — e.g. a
 * params object copied from a screenshot that predates `imageSize`
 * being included. Style-config absence semantics are preserved exactly:
 * no `classicConfig` means no `clf`, which selects the legacy Classic
 * generator, matching the puzzle the block described.
 */
export function reproParamsToPayload(params: ReproParams): SharePayload {
    function required<T>(value: T | undefined, name: string): T {
        if (value === undefined) {
            throw new Error(`Repro params missing required field: ${name}`);
        }
        return value;
    }

    const imageSize = required(params.imageSize, 'imageSize');
    const gridSize = required(params.gridSize, 'gridSize');
    const payload: SharePayload = {
        v: 1,
        i: params.imageUrl ?? 'blank',
        is: [imageSize.width, imageSize.height],
        g: [gridSize.cols, gridSize.rows],
        c: required(params.cutStyle, 'cutStyle') as SharePayload['c'],
        s: required(params.seed, 'seed'),
        r: params.rotationMode ?? 'none',
    };
    applyStyleConfigs(payload, params);
    return payload;
}
```

Note the doc-comment on `buildReproParams` moves with the function from `info-modal.ts` (both paragraphs — the summary and the Classic note).

- [ ] **Step 5: Swap the modal over**

In `src/ui/info-modal.ts`: delete the local `buildReproParams` (`:64-84`), add `import { buildReproParams } from '../sharing/repro-params.js';`, and change the description string (`:544-546`) to:

```ts
    desc.textContent =
        'Parameters needed to regenerate this exact puzzle. Include in bug '
        + 'reports, or paste into __reproPuzzle(...) in the browser console '
        + 'to replay it.';
```

In `src/ui/info-modal.test.ts`, extend the block-content test (`:46-62`) to assert the two new fields appear in the parsed JSON (match the fixture state's `imageUrl`/`imageSize`), and check the omit-undefined test (`:73`) still holds — `imageUrl`/`imageSize` are always-present fields on `GameState`, so it should be unaffected.

- [ ] **Step 6: Run the new tests, then typecheck + full suite**

Run: `npx vitest run src/sharing/repro-params.test.ts src/ui/info-modal.test.ts src/sharing/share-link.test.ts`
Expected: PASS — share-link tests unmodified (the extraction is byte-neutral on payloads).
Then: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sharing/repro-params.ts src/sharing/repro-params.test.ts src/sharing/share-link.ts src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "feat: include image url and dimensions in the repro params block

Geometry inscribes to the image, so the same seed/grid/style cuts
differently at different image dimensions - a repro block without
imageSize under-specifies the puzzle. The block's builder moves to a
shared sharing/repro-params module together with a params-to-payload
mapping, ahead of a console helper that replays the block's JSON."
```

---

### Task 2: `__reproPuzzle` console helper

**Files:**
- Modify: `src/main.ts` (next to `__newComposableGame`, ~line 585; imports at ~113)

**Interfaces:**
- Consumes: `reproParamsToPayload`, `ReproParams` (Task 1); `encodePayload`, `decodePayload` from `./sharing/share-link.js` (add to the existing import); `clearSavedState` (already imported); `loadSharedPuzzle` (module-local, `main.ts:1414`).

- [ ] **Step 1: Add the helper**

After the `__newComposableGame` assignment in `src/main.ts`:

```ts
/**
 * Dev-console hook: regenerate a puzzle from the info modal's
 * "Reproduction parameters" block. Paste the block's JSON verbatim:
 *
 *   __reproPuzzle({
 *       seed: 1534700170,
 *       cutStyle: 'classic',
 *       imageUrl: 'https://images.unsplash.com/...',
 *       imageSize: { width: 1080, height: 1440 },
 *       gridSize: { cols: 12, rows: 16 },
 *       rotationMode: 'free',
 *       classicConfig: { traceSetVersion: 1 },
 *   })
 *
 * The params run through the share codec's validation and clamps and
 * then the share-link load path, so reproduction semantics match a
 * share link exactly. Without an `imageUrl` the puzzle renders on the
 * blank canvas at the recorded dimensions — geometry depends on the
 * image's dimensions, not its pixels. Replaces the current game and
 * save without confirmation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__reproPuzzle = (params: ReproParams) => {
    let decoded: SharePayload | null;
    try {
        decoded = decodePayload(encodePayload(reproParamsToPayload(params)));
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[__reproPuzzle]', err instanceof Error ? err.message : err);
        return;
    }
    if (!decoded) {
        // eslint-disable-next-line no-console
        console.error('[__reproPuzzle] params did not survive share-codec validation');
        return;
    }
    clearSavedState();
    void loadSharedPuzzle(decoded, false);
};
```

Add `encodePayload`, `decodePayload` to the existing `./sharing/share-link.js` import group and `import { reproParamsToPayload, type ReproParams } from './sharing/repro-params.js';`. Match the surrounding eslint-comment style (check how `__newComposableGame`'s `(window as any)` line is annotated and mirror it).

- [ ] **Step 2: Typecheck, full suite, and a smoke check**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (`main.ts` has no unit tests; the helper is thin glue over Task 1's tested functions).
Then: `npm run build`
Expected: clean — proves the new cross-module imports don't break the production build.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add __reproPuzzle console hook replaying repro params

Accepts the exact JSON the info modal's repro block prints and routes
it through the share codec's validation and the share-link load path,
so a bug report's parameters regenerate the identical puzzle in one
paste."
```

---

### Task 3: Push and open the PR

- [ ] **Step 1: Final verification**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --title "feat: repro params carry the image contract and replay via __reproPuzzle" --body "$(cat <<'EOF'
## Summary

Closes the loop on the info modal's "Reproduction parameters" block:

- **The block now includes `imageUrl` and `imageSize`.** Generators
  inscribe the puzzle into the image rectangle, so the same
  seed/grid/style cuts differently at different image dimensions — the
  fused-piece investigation (seed 1534700170, 12×16 classic) reproduced
  only at 1080×1440. Without `imageSize` the block under-specifies the
  puzzle it documents.
- **New dev-console helper `__reproPuzzle(params)`** accepts the block's
  exact JSON and regenerates that puzzle through the share codec's
  validation/clamps and the share-link load path. Without an `imageUrl`
  it renders on the blank canvas at the recorded dimensions.
- The five per-style config blocks in `gameStateToPayload` moved to a
  shared `applyStyleConfigs` (pure refactor — payloads byte-identical),
  so the wire mapping exists once.

`__newComposableGame` is unchanged; no analytics changes; the only help
copy touched is the debug-panel block description.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** both fields → Task 1 Step 4; helper → Task 2; modal description → Task 1 Step 5; validation-throw behavior → Task 1 tests; round-trip pin → Task 1 test; non-changes respected (no `__newComposableGame` edits, no analytics).
- **Type consistency:** `ReproParams extends StyleConfigSource`; `applyStyleConfigs(payload, source)` consumed with those names in both `gameStateToPayload` and `reproParamsToPayload`; Task 2 imports the exact Task 1 exports.
- **Share-link neutrality:** the extraction keeps block order inside `gameStateToPayload` (inserted at the first block's position), and existing share-link tests are required to pass unmodified.
