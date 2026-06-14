# Wavy Borderless Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a borderless option to the Wavy cut style, wiring up persistence, share-link, the new-game dialog, and help text — generation is already free because Wavy uses the sine base cut generator (which supports borderless from #415).

**Architecture:** Give Wavy a dedicated minimal `wavyConfig: { borderless }` (mirroring Fractal's `fractalConfig`): the wavy strategy passes `borderless` into its inline sine `ComposableConfig` (sine oversizes + the existing strip runs), and the flag threads through a new preference, `GameState.wavyConfig`, serialization, a `wf` share-link field, and a dialog checkbox. The bordered path is untouched, preserving the PRNG/reproducibility contract.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom + node). Spec: `docs/superpowers/specs/2026-06-14-wavy-borderless-design.md`.

---

## File Structure

- Create: `src/game/wavy-config.ts` (+ test) — localStorage preference, mirrors `fractal-config.ts`.
- Modify: `src/model/types.ts` — add `GameState.wavyConfig`.
- Modify: `src/game/cut-style-strategies.ts` (+ test) — `StrategyContext.wavyConfig`, widen `configKey`, wavy `configKey` + `borderless` in the inline config.
- Modify: `src/game/init.ts` — thread `wavyConfig` through `InitOptions`/ctx/writeback.
- Modify: `src/persistence/serialization.ts` (+ test) — round-trip `wavyConfig`.
- Modify: `src/sharing/share-link.ts` (+ test) — `wf` payload encode.
- Modify: `src/ui/new-game-dialog.ts` (+ test) — `WavyDialogConfig`, `buildWavyOptionsSection`, selection/visibility.
- Modify: `src/main.ts` — thread `wavyConfig` through `startNewGame`, dialog, share decode, startup.
- Modify: `src/ui/info-modal.ts` (+ test) — Wavy help-text bullet.

Reproducibility note for every task: the oversize/strip only fire when `borderless === true`. Never change the sine config the wavy strategy builds for the `borderless` false/absent case — that's the share-link/save contract for all existing Wavy puzzles.

---

## Task 1: Wavy preference module

**Files:**
- Create: `src/game/wavy-config.ts`
- Test: `src/game/wavy-config.test.ts`

This mirrors `src/game/fractal-config.ts` exactly (read that file first to match its style).

- [ ] **Step 1: Write the failing test**

Create `src/game/wavy-config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
    WAVY_CONFIG_KEY,
    loadWavyConfigPreference,
    saveWavyConfigPreference,
} from './wavy-config.js';

describe('wavy-config preference', () => {
    beforeEach(() => localStorage.clear());

    it('returns undefined when nothing is saved', () => {
        expect(loadWavyConfigPreference()).toBeUndefined();
    });

    it('round-trips borderless: true', () => {
        saveWavyConfigPreference({ borderless: true });
        expect(loadWavyConfigPreference()).toEqual({ borderless: true });
    });

    it('round-trips borderless: false', () => {
        saveWavyConfigPreference({ borderless: false });
        expect(loadWavyConfigPreference()).toEqual({ borderless: false });
    });

    it('coerces a non-boolean stored borderless to a boolean', () => {
        localStorage.setItem(WAVY_CONFIG_KEY, JSON.stringify({ borderless: 1 }));
        expect(loadWavyConfigPreference()).toEqual({ borderless: true });
    });

    it('returns undefined for a malformed stored value (no borderless key)', () => {
        localStorage.setItem(WAVY_CONFIG_KEY, JSON.stringify({ nope: true }));
        expect(loadWavyConfigPreference()).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npx vitest run src/game/wavy-config.test.ts`
Expected: FAIL — cannot resolve `./wavy-config.js`.

- [ ] **Step 3: Implement**

Create `src/game/wavy-config.ts`:

```ts
/**
 * Wavy cut style configuration — types and persistence.
 *
 * The wavy cut style exposes a "borderless" toggle (strip the outer ring
 * of pieces so every piece has a tab/blank on all sides). Player choices
 * are persisted as JSON in localStorage. Mirrors `fractal-config.ts`.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved wavy config. */
export const WAVY_CONFIG_KEY = 'puzzle-wavy-config';

/** Shape of the wavy config stored in preferences. */
export interface WavyConfigPreference {
    borderless: boolean;
}

function parseWavyConfig(raw: unknown): WavyConfigPreference | undefined {
    if (typeof raw !== 'object' || raw === null || !('borderless' in raw)) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        borderless: Boolean(config.borderless),
    };
}

const store = createJsonPreference<WavyConfigPreference>({
    key: WAVY_CONFIG_KEY,
    parse: parseWavyConfig,
});

/** Save the wavy config to localStorage. */
export const saveWavyConfigPreference = store.save;

/**
 * Load the wavy config from localStorage.
 * Returns undefined if nothing is saved or the value is invalid.
 */
export const loadWavyConfigPreference = store.load;
```

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run src/game/wavy-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/wavy-config.ts src/game/wavy-config.test.ts
git commit -m "feat: add wavy-config borderless preference (#139)"
```

---

## Task 2: GameState type + strategy + init wiring

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/game/cut-style-strategies.ts`
- Modify: `src/game/init.ts`
- Test: `src/game/cut-style-strategies.test.ts`

- [ ] **Step 1: Add the GameState field**

In `src/model/types.ts`, immediately after the `fractalConfig?: { borderless?: boolean };` block on `GameState`, add:

```ts
    /**
     * Wavy-cut config (only set when cutStyle === 'wavy').
     *
     * Needed to reproduce the puzzle from its seed and surfaced in the
     * Debug panel. Mirrors {@link GameState.fractalConfig}.
     */
    wavyConfig?: {
        borderless?: boolean;
    };
```

- [ ] **Step 2: Write the failing strategy tests**

In `src/game/cut-style-strategies.test.ts`, find the existing `createNewGame with cutStyle "wavy"` test (it asserts both configs are undefined). Add a sibling test block after it. (Match the file's existing imports/`createNewGame` usage — it already imports `createNewGame` and builds an image/viewport; copy that setup.)

```ts
describe('wavy borderless', () => {
    const imageUrl = 'test.png';
    const imageSize = { width: 800, height: 600 };
    const viewport = { width: 1000, height: 800 };

    it('writes wavyConfig back onto state when borderless is set', () => {
        const state = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy',
            wavyConfig: { borderless: true },
            seed: 123,
        });
        expect(state.wavyConfig).toEqual({ borderless: true });
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });

    it('leaves wavyConfig undefined when none is provided', () => {
        const state = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy',
            seed: 123,
        });
        expect(state.wavyConfig).toBeUndefined();
    });

    it('borderless wavy nets to the requested piece count (oversize + strip)', () => {
        const bordered = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy', seed: 123,
        });
        const borderless = createNewGame(imageUrl, imageSize, viewport, { cols: 4, rows: 3 }, {
            cutStyle: 'wavy', wavyConfig: { borderless: true }, seed: 123,
        });
        // Wavy may auto-group sub-pixel slivers, so compare piece counts:
        // borderless oversizes to 6x5 then strips the ring back to ~4x3.
        expect(bordered.pieces.length).toBe(12);
        expect(borderless.pieces.length).toBe(12);
    });
});
```

If the existing `cutStyle "wavy"` test asserts only `composableConfig`/`fractalConfig` undefined, also add `expect(state.wavyConfig).toBeUndefined();` to it so the no-config case stays locked.

- [ ] **Step 3: Run them (fail)**

Run: `npx vitest run src/game/cut-style-strategies.test.ts`
Expected: FAIL — `wavyConfig` is not accepted by `InitOptions` / not written back.

- [ ] **Step 4: Widen the strategy types + wavy strategy**

In `src/game/cut-style-strategies.ts`:

Add `wavyConfig` to `StrategyContext` (after `composableConfig?`):

```ts
    wavyConfig?: { borderless?: boolean };
```

Widen `CutStyleStrategy.configKey`:

```ts
    configKey?: 'fractalConfig' | 'composableConfig' | 'wavyConfig';
```

Update `wavyStrategy` — add `borderless` to the inline config and a `configKey`:

```ts
const wavyStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) => {
        const avgPieceArea =
            (puzzleSize.width * puzzleSize.height) /
            (grid.cols * grid.rows);
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
            tabGenerator: 'classic',
            tabConfig: {},
            minPieceArea: avgPieceArea / 4,
            borderless: ctx.wavyConfig?.borderless ?? false,
            tabDebug: ctx.tabDebug,
        });
    },
    configKey: 'wavyConfig',
};
```

- [ ] **Step 5: Thread `wavyConfig` through init.ts**

In `src/game/init.ts`:

Add `wavyConfig` to `InitOptions` (find the interface; it already has `composableConfig?`/`fractalConfig?`):

```ts
    wavyConfig?: { borderless?: boolean };
```

In `createNewGame`, add it to the strategy `ctx`:

```ts
    const ctx = {
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
        wavyConfig: options.wavyConfig,
        tabDebug,
    };
```

And add the write-back in the returned object (next to the composable/fractal write-backs):

```ts
        wavyConfig: strategy.configKey === 'wavyConfig' ? options.wavyConfig : undefined,
```

- [ ] **Step 6: Run them (pass)**

Run: `npx vitest run src/game/cut-style-strategies.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/model/types.ts src/game/cut-style-strategies.ts src/game/init.ts src/game/cut-style-strategies.test.ts
git commit -m "feat: wire wavy borderless through the cut-style strategy (#139)"
```

---

## Task 3: Serialization round-trip

**Files:**
- Modify: `src/persistence/serialization.ts`
- Test: `src/persistence/serialization.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/persistence/serialization.test.ts`, mirror the existing composable/fractal config round-trip test:

```ts
it('round-trips wavyConfig.borderless through serializeState/deserializeState', () => {
    const state = makeGameState({
        cutStyle: 'wavy',
        wavyConfig: { borderless: true },
    });
    const restored = deserializeState(serializeState(state));
    expect(restored.wavyConfig).toEqual({ borderless: true });
});
```

(Use the file's existing helpers — `makeGameState`, `serializeState`, `deserializeState` — matching the composable test's exact form. If the file tests via `JSON.parse(JSON.stringify(...))` instead, follow that form.)

- [ ] **Step 2: Run it (fails)**

Run: `npx vitest run src/persistence/serialization.test.ts`
Expected: FAIL — `wavyConfig` dropped (not in `SerializedGameState`, not written/read).

- [ ] **Step 3: Implement**

In `src/persistence/serialization.ts`:

Add to `SerializedGameState` (after the `fractalConfig?` field):

```ts
    /**
     * Wavy-cut config (only set when cutStyle === 'wavy').
     */
    wavyConfig?: GameState['wavyConfig'];
```

Add the same field to `SerializedStaticState` (after its `fractalConfig?` field):

```ts
    wavyConfig?: GameState['wavyConfig'];
```

In `serializeState`, after the `if (state.fractalConfig) { serialized.fractalConfig = state.fractalConfig; }` block:

```ts
    if (state.wavyConfig) {
        serialized.wavyConfig = state.wavyConfig;
    }
```

In `serializeStatic`, after `if (state.fractalConfig) s.fractalConfig = state.fractalConfig;`:

```ts
    if (state.wavyConfig) s.wavyConfig = state.wavyConfig;
```

In `deserializeState`, after the fractal-config resolution block (`const fractalConfig = resolveFractalConfig(data); if (fractalConfig) { state.fractalConfig = fractalConfig; }`):

```ts
    if (data.wavyConfig) {
        state.wavyConfig = data.wavyConfig;
    }
```

In `recombine` (the static path), after `const fractalConfig = resolveFractalConfig(staticData); if (fractalConfig) state.fractalConfig = fractalConfig;`:

```ts
    if (staticData.wavyConfig) state.wavyConfig = staticData.wavyConfig;
```

(No resolver and no `STATE_VERSION` bump: Wavy never had a config, so there's no legacy shape to migrate, and the field is additive/optional like `selection`.)

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run src/persistence/serialization.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/serialization.ts src/persistence/serialization.test.ts
git commit -m "feat: round-trip wavyConfig in serialization (#139)"
```

---

## Task 4: Share-link `wf` field

**Files:**
- Modify: `src/sharing/share-link.ts`
- Test: `src/sharing/share-link.test.ts`

Mirror fractal's `ff: { bl }` exactly: the payload carries `wf`, `gameStateToPayload` emits it for wavy, and `decodePayload`/`encodePayload` round-trip it. (The `wf → wavyConfig` mapping itself lives in `main.ts`, Task 6 — fractal's `ff → fractalConfig` mapping is likewise in `main.ts`, not in share-link.) `wf` is not added to `isValidPayload`, matching fractal's `ff` (the decode read is crash-safe and the sine generator only acts on `borderless === true`).

- [ ] **Step 1: Write the failing test**

In `src/sharing/share-link.test.ts`, near the fractal `ff` round-trip test:

```ts
it('round-trips a wavy borderless payload (wf)', () => {
    const payload: SharePayload = {
        v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'wavy', s: 7, r: 'none',
        wf: { bl: true },
    };
    expect(decodePayload(encodePayload(payload))).toEqual(payload);
});

it('gameStateToPayload emits wf for a borderless wavy state', () => {
    const state = makeGameState({
        cutStyle: 'wavy',
        seed: 7,
        wavyConfig: { borderless: true },
    });
    const payload = gameStateToPayload(state, { includeProgress: false });
    expect(payload.wf).toEqual({ bl: true });
});

it('gameStateToPayload omits wf for a non-wavy state', () => {
    const state = makeGameState({ cutStyle: 'classic', seed: 7 });
    const payload = gameStateToPayload(state, { includeProgress: false });
    expect(payload.wf).toBeUndefined();
});
```

(Match the file's existing imports — `SharePayload`, `decodePayload`, `encodePayload`, `gameStateToPayload`, `makeGameState` — and the exact options shape `gameStateToPayload` takes; copy the fractal test's call form.)

- [ ] **Step 2: Run it (fails)**

Run: `npx vitest run src/sharing/share-link.test.ts`
Expected: FAIL — `wf` not on the payload type / not emitted.

- [ ] **Step 3: Implement**

In `src/sharing/share-link.ts`:

Add `wf` to `SharePayload`, right after the `ff?: { bl: boolean };` line:

```ts
    /** Wavy-cut config. */
    wf?: { bl: boolean };
```

In `gameStateToPayload`, after the fractal block (`if (cutStyle === 'fractal' && state.fractalConfig) { payload.ff = { bl: state.fractalConfig.borderless ?? false }; }`):

```ts
    if (cutStyle === 'wavy' && state.wavyConfig) {
        payload.wf = { bl: state.wavyConfig.borderless ?? false };
    }
```

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run src/sharing/share-link.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat: encode wavy borderless on share links (#139)"
```

---

## Task 5: New-game dialog

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Test: `src/ui/new-game-dialog.test.ts`

Mirror `buildFractalOptionsSection` / `FractalSection` / `FractalDialogConfig`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/new-game-dialog.test.ts`, mirror the fractal borderless test (find it for the exact `createNewGameDialog` invocation + how the test reads the selection — copy that form):

```ts
it('shows a Borderless toggle for wavy and feeds it into the selection', () => {
    const onSelect = vi.fn();
    createNewGameDialog({
        container,
        selectedSizeId: '24',
        selectedCutStyleId: 'wavy',
        onSelect,
    });

    const toggle = container.querySelector<HTMLInputElement>('[data-testid="wavy-borderless-toggle"]');
    expect(toggle).not.toBeNull();
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event('change'));

    // Trigger selection the same way the existing dialog tests do (size click / start).
    container.querySelectorAll<HTMLElement>('.size-picker-option')[0].click();

    expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ wavyConfig: { borderless: true } }),
    );
});

it('does not emit wavyConfig when the cut style is not wavy', () => {
    const onSelect = vi.fn();
    createNewGameDialog({
        container,
        selectedSizeId: '24',
        selectedCutStyleId: 'classic',
        onSelect,
    });
    container.querySelectorAll<HTMLElement>('.size-picker-option')[0].click();
    expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ wavyConfig: undefined }),
    );
});
```

If the existing tests trigger `onSelect` differently (e.g. a Start button), use that exact mechanism instead of the `.size-picker-option` click.

- [ ] **Step 2: Run them (fail)**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — no `wavy-borderless-toggle`, no `wavyConfig` in selection.

- [ ] **Step 3: Implement the dialog**

In `src/ui/new-game-dialog.ts`:

Add the config type after `FractalDialogConfig`:

```ts
/** Wavy generator config passed through from the dialog. */
export interface WavyDialogConfig {
    borderless: boolean;
}
```

Add the section interface after `FractalSection`:

```ts
interface WavySection {
    element: HTMLElement;
    getValues(): WavyDialogConfig;
    setVisible(visible: boolean): void;
}
```

Add `wavyConfig?` to `NewGameSelection` (after `fractalConfig?`):

```ts
    /** Present only when the chosen cut style is wavy. */
    wavyConfig?: WavyDialogConfig;
```

Add `savedWavyConfig?` to `NewGameDialogOptions` (after `savedFractalConfig?`):

```ts
    /** Previously saved wavy config (used to pre-populate the borderless toggle). */
    savedWavyConfig?: WavyDialogConfig;
```

Add the section builder next to `buildFractalOptionsSection`:

```ts
function buildWavyOptionsSection(args: {
    saved?: WavyDialogConfig;
}): WavySection {
    const section = document.createElement('div');
    section.className = 'wavy-options';

    const borderlessCheckbox = appendCheckboxRow(section, 'Borderless', args.saved?.borderless ?? false);
    borderlessCheckbox.dataset.testid = 'wavy-borderless-toggle';

    return {
        element: section,
        getValues: () => ({
            borderless: borderlessCheckbox.checked,
        }),
        setVisible: (visible) => {
            section.style.display = visible ? 'block' : 'none';
        },
    };
}
```

In the dialog body, build the section next to the fractal one (after `const fractalSection = buildFractalOptionsSection({ saved: options.savedFractalConfig });`):

```ts
    const wavySection = buildWavyOptionsSection({ saved: options.savedWavyConfig });
```

In the selection-assembly object (where `fractalConfig: currentCutStyleId === 'fractal' ? fractalSection.getValues() : undefined` is built), add:

```ts
                wavyConfig: currentCutStyleId === 'wavy'
                    ? wavySection.getValues()
                    : undefined,
```

In the cut-style `onChange` handler (where `fractalSection.setVisible(id === 'fractal'); composableSection.setVisible(id === 'composable');`), add:

```ts
            wavySection.setVisible(id === 'wavy');
```

In the initial-visibility block (where `fractalSection.setVisible(currentCutStyleId === 'fractal'); composableSection.setVisible(currentCutStyleId === 'composable');`), add:

```ts
    wavySection.setVisible(currentCutStyleId === 'wavy');
```

And append the section element to the dialog next to the others (where `dialog.appendChild(fractalSection.element);`):

```ts
    dialog.appendChild(wavySection.element);
```

- [ ] **Step 4: Run them (pass)**

Run: `npx vitest run src/ui/new-game-dialog.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat: add wavy borderless toggle to the new-game dialog (#139)"
```

---

## Task 6: main.ts wiring

**Files:**
- Modify: `src/main.ts`

`main.ts` has no unit test; verify via `npx tsc --noEmit` (which catches positional-arg mismatches because `wavyConfig` is an object type distinct from the boolean params around it) plus the suite.

- [ ] **Step 1: Imports**

Add to the `src/game/...` import area (next to `loadFractalConfigPreference` / `saveFractalConfigPreference`):

```ts
import { loadWavyConfigPreference, saveWavyConfigPreference } from './game/wavy-config.js';
```

(If `loadFractalConfigPreference` is imported via a barrel such as `./game/index.js`, add the wavy ones to that same import path — check how the fractal ones are imported and match it. Ensure `wavy-config.ts` is exported from that barrel if one is used.)

Also import the `WavyDialogConfig` type from the dialog next to `FractalDialogConfig`:

```ts
import type { WavyDialogConfig } from './ui/new-game-dialog.js';
```

(Match however `FractalDialogConfig` is currently imported.)

- [ ] **Step 2: Add the `startNewGame` parameter**

In `startNewGame`'s signature, add `wavyConfig` immediately after `fractalConfig`:

```ts
async function startNewGame(
    gridSize: GridSize,
    cutStyle: CutStyle = 'classic',
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig,
    imageSource?: string,
    imageCategory?: string,
    fractalConfig?: FractalDialogConfig,
    wavyConfig?: WavyDialogConfig,
    vibrant: boolean = false,
    rotationEnabled: boolean = false,
    freeRotation: boolean = false,
    seed?: number,
): Promise<void> {
```

Inside `startNewGame`, where `generatorFractalConfig` is built, add the wavy equivalent and pass it into `createNewGame`'s options:

```ts
        const generatorFractalConfig = fractalConfig
            ? { borderless: fractalConfig.borderless }
            : undefined;
        const generatorWavyConfig = wavyConfig
            ? { borderless: wavyConfig.borderless }
            : undefined;
```

and in the `createNewGame(..., { ... })` options object, add after `fractalConfig: generatorFractalConfig,`:

```ts
            wavyConfig: generatorWavyConfig,
```

- [ ] **Step 3: Update every `startNewGame` call site**

Run `grep -n "startNewGame(" src/main.ts` to find them all. Insert the new positional arg (the `wavyConfig`, between `fractalConfig` and `vibrant`) at each call that reaches that position:

- **Dialog `onSelect`** (passes `..., fractalConfig, vibrant, rotationEnabled, freeRotation`): insert `wavyConfig` after `fractalConfig`:
  ```ts
                startNewGame(
                    toGridSize(option),
                    cutStyle,
                    composableConfig
                        ? sliderConfigToGeneratorConfig(composableConfig)
                        : undefined,
                    imageSource,
                    imageCategory,
                    fractalConfig,
                    wavyConfig,
                    vibrant,
                    rotationEnabled,
                    freeRotation,
                ).catch(...)
  ```
  (`wavyConfig` here is destructured from the `onSelect` arg — see Step 4.)
- **Startup/auto-start path** (the `await startNewGame(...)` near the preferred-config block): insert `preferredWavyConfig` after `preferredFractalConfig` (see Step 5).
- **`__newComposableGame` dev hook** (passes `..., undefined /*fractalConfig*/, vibrant, rotation!=='none', ...`): insert `undefined` for `wavyConfig` after the fractal `undefined`.
- **`__startVennPuzzle` dev hook** (passes only `(grid, 'composable', config, 'blank')` — 4 args): no change (it never reaches the `wavyConfig` position).

After editing, `npx tsc --noEmit` will flag any call site you missed (a boolean passed where `WavyDialogConfig | undefined` is expected).

- [ ] **Step 4: Dialog construction + onSelect**

In the `createNewGameDialog({ ... })` options, add after `savedFractalConfig: savedFractalConfig,`:

```ts
            savedWavyConfig: loadWavyConfigPreference(),
```

In the `onSelect: ({ ... }) => { ... }` destructure, add `wavyConfig`:

```ts
            onSelect: ({ sizeId, cutStyleId, composableConfig, fractalConfig, wavyConfig, rotationEnabled, freeRotation, imageSource, imageCategory, vibrant }) => {
```

And add the save next to the fractal save:

```ts
                if (wavyConfig) {
                    saveWavyConfigPreference(wavyConfig);
                }
```

- [ ] **Step 5: Startup/auto-start path**

In the preferred-config block (where `const preferredFractalConfig = loadFractalConfigPreference();` is), add:

```ts
        const preferredWavyConfig = loadWavyConfigPreference();
```

and pass it in that path's `startNewGame(...)` call, after `preferredFractalConfig`:

```ts
            preferredFractalConfig,
            preferredWavyConfig,
            loadVibrantPreference(),
            preferredRotationEnabled,
            preferredFreeRotationEnabled,
```

- [ ] **Step 6: Share-link decode**

In the share-link `createNewGame(..., { ... })` options (where `fractalConfig: payload.ff ? { borderless: payload.ff.bl } : undefined,` is), add:

```ts
            wavyConfig: payload.wf ? { borderless: payload.wf.bl } : undefined,
```

- [ ] **Step 7: Type-check + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat: thread wavy borderless through new-game, share, and startup paths (#139)"
```

---

## Task 7: Help text

**Files:**
- Modify: `src/ui/info-modal.ts`
- Test: `src/ui/info-modal.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/ui/info-modal.test.ts`, mirror however the modal is rendered in existing tests (find the Cut Styles section test):

```ts
it('mentions Borderless in the Wavy cut-style help', () => {
    const container = document.createElement('div');
    createInfoModal({ container });
    const text = container.textContent ?? '';
    expect(text).toContain('Borderless');
});
```

(If the file already asserts `Borderless` for fractal/composable, scope this to the Wavy `<li>` instead, matching the existing assertion style, so it can't pass off another section's text.)

- [ ] **Step 2: Run it (fails if not already present)**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: FAIL if no other section already prints "Borderless" in the rendered help; otherwise tighten the assertion to the Wavy bullet (see note above) so it fails for the right reason.

- [ ] **Step 3: Implement**

In `src/ui/info-modal.ts`, in the Wavy `<li>`'s sub-list (`wavySub`), add a Borderless bullet before or after the existing Free-rotation one:

```ts
    appendInlineLi(wavySub, [
        ['strong', 'Borderless'],
        ' — Removes the flat frame so every piece has a wavy tab or blank on all four sides (a harder puzzle). Pick it in the New Game dialog when Wavy is selected.',
    ]);
```

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "docs: add wavy borderless to the in-app help (#139)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Whole suite + type-check + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass / clean / build succeeds.

- [ ] **Step 2: Manual smoke (recommended)**

`npm run dev`, open New Game → **Wavy**, tick **Borderless**, start a game. Confirm: pieces have wavy tabs on all sides (no flat frame); the requested piece count is produced; reload reproduces the same puzzle (borderless persisted); a copied share link reopened reproduces it. Toggle Borderless off → classic bordered Wavy still works and existing Wavy share links still reproduce.

---

## Self-Review notes

- **Spec coverage:** preference (Task 1); GameState/strategy/init generation + write-back (Task 2); serialization (Task 3); share-link `wf` (Task 4); dialog toggle (Task 5); main wiring incl. startNewGame param/call-sites, dialog save/load, share decode, startup (Task 6); help text — Wavy is production-visible (Task 7); reproducibility preserved (borderless gated; Tasks 2 & the unchanged sine config). All covered.
- **Type consistency:** `wavyConfig` is the field name on `GameState`, `InitOptions`, `StrategyContext`, `NewGameSelection`; `WavyDialogConfig { borderless }` is the dialog type and the `startNewGame`/onSelect param type; `wavyConfig: { borderless?: boolean }` is the generator/state shape; `configKey: 'wavyConfig'`; share key `wf: { bl }`; preference `WavyConfigPreference`; testid `wavy-borderless-toggle`; localStorage key `puzzle-wavy-config`. Consistent across tasks.
- **No generator change:** sine oversize + `stripBorderRing` already support borderless (#415); Task 2 only flips the flag in the wavy strategy's inline config.
