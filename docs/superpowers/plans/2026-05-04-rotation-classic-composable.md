# Rotation for Classic and Composable cut styles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players opt into 90°-snap rotation for Classic and Composable puzzles, by promoting "Enable rotation" out of the fractal-only options into a top-level new-game dialog setting that applies to any cut style.

**Architecture:** Engine, model, share-link codec, persistence, renderer, and rotate-buttons UI are already cut-style-agnostic. The change is contained to: a new top-level `rotation-preference` localStorage module, a new top-level dialog row, removal of `rotationEnabled` from `FractalConfigPreference`/`FractalDialogConfig`, a one-line wiring change in `startNewGame`, and help-text copy updates. No model, generator, share-link, or persistence changes.

**Tech Stack:** TypeScript, Vitest + jsdom, Vite. Pure DOM (no framework). Project has no linter beyond `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-05-04-rotation-classic-composable-design.md`

---

## File Structure

**Create:**
- `src/ui/rotation-preference.ts` — `puzzle-rotation-enabled` boolean preference (uses `createBooleanPreference`)
- `src/ui/rotation-preference.test.ts` — round-trip + default-false coverage

**Modify:**
- `src/ui/index.ts` — re-export the new preference helpers
- `src/game/fractal-config.ts` — drop `rotationEnabled` from `FractalConfigPreference` and its parser
- `src/game/fractal-config.test.ts` — drop `rotationEnabled` from fixtures and assertions
- `src/ui/new-game-dialog.ts` — drop `rotationEnabled` from `FractalDialogConfig`/fractal section; add a top-level "Enable rotation" row; thread `rotationEnabled` through `NewGameSelection`
- `src/ui/new-game-dialog.test.ts` — update `onSelect` expectations; add coverage for the new top-level checkbox
- `src/main.ts` — load/save the new preference; pass `rotationEnabled` to `startNewGame`; replace the `cutStyle === 'fractal' && fractalConfig?.rotationEnabled` derivation with `rotationEnabled ? 'quarter-turn' : 'none'`
- `src/ui/info-modal.ts` — generalize the rotate-buttons help bullet; drop the fractal-only "Enable rotation" sub-bullet
- `src/game/init.test.ts` — extend `rotationMode === 'quarter-turn'` coverage to classic and composable cut styles
- `src/sharing/share-link.test.ts` — add classic-with-rotation and composable-with-rotation round-trip cases

---

## Verification commands (run in repo root)

- Type check: `npx tsc --noEmit`
- All tests: `npm test`
- Single test file: `npx vitest run path/to/file.test.ts`
- Single test by name: `npx vitest run path/to/file.test.ts -t "test name fragment"`

A task is "green" when both type-check and the affected test files pass.

---

## Task 1: New `rotation-preference` module

**Files:**
- Create: `src/ui/rotation-preference.ts`
- Create: `src/ui/rotation-preference.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/ui/rotation-preference.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    ROTATION_ENABLED_PREFERENCE_KEY,
    saveRotationEnabledPreference,
    loadRotationEnabledPreference,
} from './rotation-preference.js';

describe('rotation-preference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to false when nothing is saved', () => {
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('round-trips true', () => {
        saveRotationEnabledPreference(true);
        expect(loadRotationEnabledPreference()).toBe(true);
    });

    it('round-trips false', () => {
        saveRotationEnabledPreference(false);
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('returns false for unparseable values', () => {
        localStorage.setItem(ROTATION_ENABLED_PREFERENCE_KEY, 'banana');
        expect(loadRotationEnabledPreference()).toBe(false);
    });

    it('persists under the documented key', () => {
        saveRotationEnabledPreference(true);
        expect(localStorage.getItem(ROTATION_ENABLED_PREFERENCE_KEY)).toBe('true');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/rotation-preference.test.ts`
Expected: FAIL — module `./rotation-preference.js` not found.

- [ ] **Step 3: Write the module**

Create `src/ui/rotation-preference.ts`:

```ts
/**
 * Rotation-enabled preference — top-level "Enable rotation" toggle for the
 * new-game dialog. Applies to any cut style.
 *
 * Disabled by default. Persisted under its own localStorage key (rather
 * than nested inside any per-style config) because rotation is orthogonal
 * to cut style.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the rotation-enabled preference. */
export const ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-rotation-enabled';

const store = createBooleanPreference({
    key: ROTATION_ENABLED_PREFERENCE_KEY,
    defaultValue: false,
});

/**
 * Load the rotation-enabled preference from localStorage.
 * Returns false (disabled) if nothing is saved or the value is invalid.
 */
export const loadRotationEnabledPreference = store.load;

/**
 * Save the rotation-enabled preference to localStorage.
 */
export const saveRotationEnabledPreference = store.save;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/rotation-preference.test.ts`
Expected: PASS — all 5 specs.

- [ ] **Step 5: Commit**

```bash
git add src/ui/rotation-preference.ts src/ui/rotation-preference.test.ts
git commit -m "feat(rotation-preference): add top-level rotation-enabled localStorage preference"
```

---

## Task 2: Re-export from `ui/index.ts`

**Files:**
- Modify: `src/ui/index.ts`

- [ ] **Step 1: Add the export**

Append to `src/ui/index.ts` (after the existing `OFFSET_DRAG_KEY` block):

```ts
export {
    ROTATION_ENABLED_PREFERENCE_KEY,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
} from './rotation-preference.js';
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/index.ts
git commit -m "feat(ui): re-export rotation-preference helpers from ui barrel"
```

---

## Task 3: Drop `rotationEnabled` from `FractalConfigPreference`

**Files:**
- Modify: `src/game/fractal-config.ts`
- Modify: `src/game/fractal-config.test.ts`

- [ ] **Step 1: Update the test file first**

Replace `src/game/fractal-config.test.ts` with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FRACTAL_CONFIG_KEY,
    saveFractalConfigPreference,
    loadFractalConfigPreference,
} from './fractal-config.js';

describe('saveFractalConfigPreference / loadFractalConfigPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns undefined when nothing is saved', () => {
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('round-trips a saved config with borderless: true', () => {
        saveFractalConfigPreference({ borderless: true });
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });

    it('round-trips a saved config with borderless: false', () => {
        saveFractalConfigPreference({ borderless: false });
        expect(loadFractalConfigPreference()).toEqual({ borderless: false });
    });

    it('returns undefined for invalid JSON', () => {
        localStorage.setItem(FRACTAL_CONFIG_KEY, 'not-json');
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('returns undefined for JSON missing borderless field', () => {
        localStorage.setItem(FRACTAL_CONFIG_KEY, JSON.stringify({ other: true }));
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('coerces truthy non-boolean borderless values to true', () => {
        localStorage.setItem(
            FRACTAL_CONFIG_KEY,
            JSON.stringify({ borderless: 1 }),
        );
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });

    it('silently ignores legacy rotationEnabled field on stored JSON', () => {
        localStorage.setItem(
            FRACTAL_CONFIG_KEY,
            JSON.stringify({ borderless: true, rotationEnabled: true }),
        );
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/fractal-config.test.ts`
Expected: FAIL — `rotationEnabled: true` still being returned in the round-trip cases.

- [ ] **Step 3: Update `fractal-config.ts`**

Replace the body of `src/game/fractal-config.ts` with:

```ts
/**
 * Fractal cut style configuration — types and persistence.
 *
 * The fractal cut style exposes a "borderless" toggle. Player choices
 * are persisted as JSON in localStorage.
 *
 * Rotation is no longer part of this config — it lives as its own
 * top-level preference in `src/ui/rotation-preference.ts` because it
 * applies to every cut style, not just fractal.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved fractal config. */
export const FRACTAL_CONFIG_KEY = 'puzzle-fractal-config';

/**
 * Shape of the fractal config stored in preferences.
 */
export interface FractalConfigPreference {
    borderless: boolean;
}

function parseFractalConfig(raw: unknown): FractalConfigPreference | undefined {
    if (typeof raw !== 'object' || raw === null || !('borderless' in raw)) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        borderless: Boolean(config.borderless),
    };
}

const store = createJsonPreference<FractalConfigPreference>({
    key: FRACTAL_CONFIG_KEY,
    parse: parseFractalConfig,
});

/**
 * Save the fractal config to localStorage.
 */
export const saveFractalConfigPreference = store.save;

/**
 * Load the fractal config from localStorage.
 * Returns undefined if nothing is saved or the value is invalid.
 */
export const loadFractalConfigPreference = store.load;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/fractal-config.test.ts`
Expected: PASS — all 7 specs.

- [ ] **Step 5: Verify the rest of the build still type-checks**

Run: `npx tsc --noEmit`
Expected: FAIL — `new-game-dialog.ts` still references `FractalConfigPreference.rotationEnabled`. That's expected; Task 4 fixes it. Do NOT proceed to commit yet — fix the breakage before committing.

- [ ] **Step 6: Postpone commit**

Skip the commit for this task. The breakage in `new-game-dialog.ts` is fixed in Task 4; commit both together at the end of Task 4.

---

## Task 4: Top-level "Enable rotation" row in the new-game dialog

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Modify: `src/ui/new-game-dialog.test.ts`

- [ ] **Step 1: Update the dialog tests first**

Find the existing test file at `src/ui/new-game-dialog.test.ts`. Update three tests:

Replace the test starting at line 72 (`'calls onSelect with the correct index when a size is clicked'`) so the expected payload includes `rotationEnabled: false`:

```ts
    it('calls onSelect with the correct index when a size is clicked', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedIndex: 1,
            onSelect,
        });

        const buttons = container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        buttons[3].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeIndex: 3,
            cutStyleIndex: 0,
            composableConfig: undefined,
            fractalConfig: undefined,
            rotationEnabled: false,
            imageSource: 'random',
            imageCategory: 'any',
            vibrant: false,
        });
    });
```

Replace the test starting near line 188 (`'passes the selected cut style index to onSelect'`):

```ts
    it('passes the selected cut style index to onSelect', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedIndex: 1,
            selectedCutStyleIndex: 1,
            onSelect,
        });

        // Click the first size option
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeIndex: 0,
            cutStyleIndex: 1,
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageSource: 'random',
            imageCategory: 'any',
            vibrant: false,
        });
    });
```

Replace the test starting near line 213 (`'updates the cut style when a different style is clicked before selecting size'`):

```ts
    it('updates the cut style when a different style is clicked before selecting size', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedIndex: 1,
            selectedCutStyleIndex: 0,
            onSelect,
        });

        // Switch to Fractal
        const cutStyleButtons =
            container.querySelectorAll<HTMLButtonElement>('.cut-style-option');
        cutStyleButtons[1].click();

        // Then pick a size
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeIndex: 0,
            cutStyleIndex: 1,
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageSource: 'random',
            imageCategory: 'any',
            vibrant: false,
        });
    });
```

Then add three new tests at the end of the `describe('createNewGameDialog', ...)` block (just before its closing `});`):

```ts
    it('exposes the top-level "Enable rotation" checkbox by default', () => {
        createNewGameDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(false);
    });

    it('passes rotationEnabled: true when the top-level checkbox is ticked, regardless of cut style', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedIndex: 1,
            selectedCutStyleIndex: 0, // Classic
            onSelect,
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                cutStyleIndex: 0,
                rotationEnabled: true,
            }),
        );
    });

    it('initialises the top-level checkbox from savedRotationEnabled', () => {
        createNewGameDialog({
            container,
            selectedIndex: 1,
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        );
        expect(checkbox?.checked).toBe(true);
    });
```

- [ ] **Step 2: Run tests to verify they fail for the right reason**

Run: `npx vitest run src/ui/new-game-dialog.test.ts`
Expected: FAIL — the existing tests fail because `fractalConfig.rotationEnabled` is still in the output and `rotationEnabled` isn't yet a top-level field; the new tests fail because `.rotation-row` doesn't exist and `savedRotationEnabled` isn't a recognised option.

- [ ] **Step 3: Update `new-game-dialog.ts`**

Edit `src/ui/new-game-dialog.ts`:

(a) Replace the `FractalDialogConfig` interface (lines 28-33) with:

```ts
/** Fractal generator config passed through from the dialog. */
export interface FractalDialogConfig {
    borderless: boolean;
}
```

(b) Update `NewGameSelection` (lines 35-46) to add `rotationEnabled`:

```ts
/** Everything the player chose in the new-game dialog. */
export interface NewGameSelection {
    sizeIndex: number;
    cutStyleIndex: number;
    /** Present only when the chosen cut style is composable. */
    composableConfig?: ComposableSliderConfig;
    /** Present only when the chosen cut style is fractal. */
    fractalConfig?: FractalDialogConfig;
    /** Whether the player ticked the top-level "Enable rotation" checkbox. */
    rotationEnabled: boolean;
    imageSource: string;
    imageCategory: string;
    vibrant: boolean;
}
```

(c) Update `NewGameDialogOptions` (lines 48-69) to accept the saved rotation preference:

```ts
export interface NewGameDialogOptions {
    /** Container to append the dialog to. */
    container: HTMLElement;
    /** Currently selected size index (highlighted in the dialog). */
    selectedIndex: number;
    /** Currently selected cut style index. */
    selectedCutStyleIndex?: number;
    /** Previously saved composable slider config (used to pre-populate sliders). */
    savedComposableConfig?: ComposableSliderConfig;
    /** Previously saved fractal config (used to pre-populate controls). */
    savedFractalConfig?: FractalDialogConfig;
    /** Previously saved rotation-enabled preference (defaults to false). */
    savedRotationEnabled?: boolean;
    /** Previously saved image source preference. */
    savedImageSource?: string;
    /** Previously saved image category preference. */
    savedImageCategory?: string;
    /** Previously saved "vibrant images" preference. */
    savedVibrant?: boolean;
    /** Called when the player selects a size. */
    onSelect: (selection: NewGameSelection) => void;
    /** Called when the dialog is dismissed without selecting. */
    onCancel?: () => void;
}
```

(d) Replace `buildFractalOptionsSection` (lines 168-187) so it no longer renders the rotation checkbox:

```ts
function buildFractalOptionsSection(args: {
    saved?: FractalDialogConfig;
}): FractalSection {
    const section = document.createElement('div');
    section.className = 'fractal-options';

    const borderlessCheckbox = appendCheckboxRow(section, 'Borderless', args.saved?.borderless ?? false);

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

(e) Inside `createNewGameDialog`, build a top-level rotation row and thread its value through `onSelect`. Find the block starting `const fractalSection = buildFractalOptionsSection(...)` (around line 407) and the dialog assembly that follows. Replace from that point to the end of the function with:

```ts
    const fractalSection = buildFractalOptionsSection({ saved: options.savedFractalConfig });
    const composableSection = buildComposableSlidersSection({ saved: options.savedComposableConfig });
    const imageSourceSection = buildImageSourceSection({
        savedImageSource: options.savedImageSource,
        savedImageCategory: options.savedImageCategory,
        savedVibrant: options.savedVibrant,
    });

    // Top-level "Enable rotation" row — applies to any cut style.
    const rotationRow = document.createElement('div');
    rotationRow.className = 'rotation-row';
    const rotationCheckbox = appendCheckboxRow(
        rotationRow,
        'Enable rotation',
        options.savedRotationEnabled ?? false,
    );

    const sizeSection = buildSizeSection({
        selectedIndex,
        getCutStyleIndex: () => currentCutStyleIndex,
        onPick: (sizeIndex) => {
            dismiss();
            onSelect({
                sizeIndex,
                cutStyleIndex: currentCutStyleIndex,
                composableConfig: currentCutStyleIndex === composableCutIndex
                    ? composableSection.getValues()
                    : undefined,
                fractalConfig: currentCutStyleIndex === fractalCutIndex
                    ? fractalSection.getValues()
                    : undefined,
                rotationEnabled: rotationCheckbox.checked,
                ...imageSourceSection.getValues(),
            });
        },
    });

    const cutStyleSection = createCutStylePicker({
        selectedIndex: currentCutStyleIndex,
        onSelect: (index) => {
            currentCutStyleIndex = index;
            sizeSection.updateLabels();
            fractalSection.setVisible(index === fractalCutIndex);
            composableSection.setVisible(index === composableCutIndex);
        },
    });

    fractalSection.setVisible(currentCutStyleIndex === fractalCutIndex);
    composableSection.setVisible(currentCutStyleIndex === composableCutIndex);

    dialog.appendChild(cutStyleSection);
    dialog.appendChild(rotationRow);
    dialog.appendChild(fractalSection.element);
    dialog.appendChild(imageSourceSection.element);
    dialog.appendChild(sizeSection.element);
    dialog.appendChild(composableSection.element);

    overlay.appendChild(dialog);

    return dismiss;
}
```

- [ ] **Step 4: Run tests and type-check to verify the dialog is consistent**

Run: `npx vitest run src/ui/new-game-dialog.test.ts && npx tsc --noEmit`
Expected:
- All dialog tests pass.
- `tsc` still fails because `main.ts` references `fractalConfig.rotationEnabled`. That's expected; Task 5 fixes it.

- [ ] **Step 5: Postpone commit**

Skip the commit; the type breakage in `main.ts` is fixed in Task 5. Tasks 3, 4, and 5 commit together at the end of Task 5.

---

## Task 5: Wire `rotationEnabled` through `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the new preference to the imports**

Find the existing UI barrel import at `src/main.ts:16-39`. Add `loadRotationEnabledPreference` and `saveRotationEnabledPreference` to that block:

```ts
import {
    createNewGameButton,
    createCentreViewButton,
    createGatherPiecesButton,
    loadColourPreference,
    saveColourPreference,
    applyBackgroundColour,
    createBackgroundColourPicker,
    createInfoButton,
    createInfoModal,
    createSelectToolButton,
    createDeselectButton,
    createRotateButtons,
    getActiveTolerance,
    createAttributionElement,
    removeAttribution,
    createNewGameDialog,
    showCompletionOverlay as renderCompletionOverlay,
    showToast,
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
    type FractalDialogConfig,
} from './ui/index.js';
```

- [ ] **Step 2: Update `startNewGame` signature and rotation-mode derivation**

In `src/main.ts`, change the `startNewGame` declaration (around lines 550-558) to add a trailing `rotationEnabled` parameter:

```ts
async function startNewGame(
    gridSize: GridSize,
    cutStyle: CutStyle = 'classic',
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig,
    imageSource?: string,
    imageCategory?: string,
    fractalConfig?: FractalDialogConfig,
    vibrant: boolean = false,
    rotationEnabled: boolean = false,
): Promise<void> {
```

Replace the rotation-mode derivation block (lines 619-622) with:

```ts
        const rotationMode: 'none' | 'quarter-turn' = rotationEnabled
            ? 'quarter-turn'
            : 'none';
```

- [ ] **Step 3: Update the new-game-button block to load/save and pass through**

Find the `createNewGameButton` block (around lines 668-717). Update its `onNewGame` handler so it loads, saves, and passes the rotation preference:

```ts
createNewGameButton({
    container: app,
    isCompleted: () => gameState.completed,
    getGroupCount: () => gameState.groups.length,
    getPieceCount: () => gameState.pieces.length,
    onNewGame: () => {
        const preferredIndex = loadSizePreference();
        const preferredCutStyleIndex = loadCutStylePreference();
        const savedComposableConfig = loadComposableConfigPreference();
        const savedFractalConfig = loadFractalConfigPreference();
        const savedRotationEnabled = loadRotationEnabledPreference();
        const savedImageSource = loadImageSourcePreference();
        const savedImageCategory = loadImageCategoryPreference();
        const savedVibrant = loadVibrantPreference();
        createNewGameDialog({
            container: app,
            selectedIndex: preferredIndex,
            selectedCutStyleIndex: preferredCutStyleIndex,
            savedComposableConfig: savedComposableConfig,
            savedFractalConfig: savedFractalConfig,
            savedRotationEnabled: savedRotationEnabled,
            savedImageSource: savedImageSource,
            savedImageCategory: savedImageCategory,
            savedVibrant: savedVibrant,
            onSelect: ({ sizeIndex, cutStyleIndex, composableConfig, fractalConfig, rotationEnabled, imageSource, imageCategory, vibrant }) => {
                saveSizePreference(sizeIndex);
                saveCutStylePreference(cutStyleIndex);
                if (composableConfig) {
                    saveComposableConfigPreference(composableConfig);
                }
                if (fractalConfig) {
                    saveFractalConfigPreference(fractalConfig);
                }
                saveRotationEnabledPreference(rotationEnabled);
                saveImageSourcePreference(imageSource);
                saveImageCategoryPreference(imageCategory);
                saveVibrantPreference(vibrant);
                const option = getSizeOption(sizeIndex);
                const cutStyle = getCutStyleOption(cutStyleIndex).id;
                clearSavedState();
                void startNewGame(
                    toGridSize(option),
                    cutStyle,
                    composableConfig,
                    imageSource,
                    imageCategory,
                    fractalConfig,
                    vibrant,
                    rotationEnabled,
                );
            },
        });
    },
});
```

- [ ] **Step 4: Run type-check and full tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — all tests green; the existing `main.ts` flow now wires the new preference through with no leftover references to `fractalConfig.rotationEnabled`.

If any test fails because of a stale `rotationEnabled` reference inside a test fixture not updated by Tasks 3/4, fix it inline. Likely files: none (we already updated `fractal-config.test.ts` and `new-game-dialog.test.ts`).

- [ ] **Step 5: Commit Tasks 3, 4, and 5 together**

```bash
git add src/game/fractal-config.ts src/game/fractal-config.test.ts \
        src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts \
        src/main.ts
git commit -m "feat(rotation): promote 'Enable rotation' to a top-level new-game option

Drops 'rotationEnabled' from FractalConfigPreference and FractalDialogConfig;
adds a top-level 'Enable rotation' checkbox to the new-game dialog that applies
to any cut style; wires the new puzzle-rotation-enabled preference through
startNewGame so Classic and Composable puzzles can now opt into 90°-snap
rotation just like Fractal."
```

---

## Task 6: Update info-modal help text

**Files:**
- Modify: `src/ui/info-modal.ts`

- [ ] **Step 1: Generalize the rotate-buttons "How to Play" bullet**

In `src/ui/info-modal.ts`, find the rotate bullet inside `buildHowToPlaySection` (around lines 131-135):

```ts
    appendInlineLi(buttons, [
        '↺ ↻ ',
        ['strong', 'Rotate'],
        ' (fractal puzzles with rotation) — Tap any piece to bring up the ↺ / ↻ buttons next to it; tap them to rotate that piece (and anything merged with it) 90°. They fade out after a few seconds or when you tap elsewhere.',
    ]);
```

Replace with:

```ts
    appendInlineLi(buttons, [
        '↺ ↻ ',
        ['strong', 'Rotate'],
        ' (when rotation is enabled) — Tap any piece to bring up the ↺ / ↻ buttons next to it; tap them to rotate that piece (and anything merged with it) 90°. They fade out after a few seconds or when you tap elsewhere.',
    ]);
```

- [ ] **Step 2: Drop the fractal-only "Enable rotation" sub-bullet**

In the same file, find `buildCutStylesSection` (around lines 149-188). Locate the fractal sub-bullet for "Enable rotation" (lines 174-177):

```ts
    appendInlineLi(fractalSub, [
        ['strong', 'Enable rotation'],
        ' — Pieces start at random 90° rotations; solve orientation as well as position. Tap a piece to reveal the ↺ / ↻ buttons next to it, then tap to rotate.',
    ]);
```

Delete those four lines. The fractal sub-list keeps only the "Borderless" item.

- [ ] **Step 3: Run the info-modal tests**

Run: `npx vitest run src/ui/info-modal.test.ts`
Expected: PASS — the existing tests don't assert on the help-text wording; they exercise the debug section, repro params, and share section.

- [ ] **Step 4: Commit**

```bash
git add src/ui/info-modal.ts
git commit -m "docs(info-modal): generalize rotation help text for any cut style"
```

---

## Task 7: Cross-style coverage tests

**Files:**
- Modify: `src/game/init.test.ts`
- Modify: `src/sharing/share-link.test.ts`

- [ ] **Step 1: Extend `init.test.ts` rotationMode coverage**

Find the `describe('rotationMode', ...)` block in `src/game/init.test.ts` (starts at line 176). Add two new tests at the end of that `describe` block (just before its closing `});`):

```ts
    it('assigns random rotations to classic-cut puzzles when rotationMode is "quarter-turn"', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.1, 0.3, 0.6, 0.9, 0.5]),
            rotationMode: 'quarter-turn',
            cutStyle: 'classic',
        });

        expect(state.rotationMode).toBe('quarter-turn');
        expect(state.cutStyle).toBe('classic');
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        for (const group of state.groups) {
            expect([0, 1, 2, 3]).toContain(group.rotation);
        }
    });

    it('assigns random rotations to composable-cut puzzles when rotationMode is "quarter-turn"', () => {
        const state = createNewGame('test.jpg', IMAGE_SIZE, VIEWPORT, DEFAULT_GRID, {
            random: seededRandom([0.1, 0.3, 0.6, 0.9, 0.5]),
            rotationMode: 'quarter-turn',
            cutStyle: 'composable',
        });

        expect(state.rotationMode).toBe('quarter-turn');
        expect(state.cutStyle).toBe('composable');
        expect(state.groups.some((g) => g.rotation !== 0)).toBe(true);
        for (const group of state.groups) {
            expect([0, 1, 2, 3]).toContain(group.rotation);
        }
    });
```

- [ ] **Step 2: Add cross-style round-trip cases to `share-link.test.ts`**

In `src/sharing/share-link.test.ts`, find the `describe('share-link codec — optional fields', ...)` block (line 50). Add two new tests inside it:

```ts
    it('round-trips classic config with quarter-turn rotation', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'classic', s: 1, r: 'quarter-turn',
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips composable config with quarter-turn rotation', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [100, 100], g: [4, 3], c: 'composable', s: 1, r: 'quarter-turn',
            cf: { ha: 0.2, hf: 1, va: 0.3, vf: 2, dt: false },
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });
```

Then in the `describe('gameStateToPayload', ...)` block (line 192), add a test that confirms `gameStateToPayload` emits `r: 'quarter-turn'` for a classic puzzle:

```ts
    it('emits r: quarter-turn for a rotated classic puzzle', () => {
        const state = buildState({
            cutStyle: 'classic',
            rotationMode: 'quarter-turn',
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.c).toBe('classic');
        expect(payload.r).toBe('quarter-turn');
        expect(payload.ff).toBeUndefined();
    });
```

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run src/game/init.test.ts src/sharing/share-link.test.ts`
Expected: PASS — all new specs pass without any production-code changes (the engine already supports rotation for any cut style; this task locks that fact in via tests).

- [ ] **Step 4: Commit**

```bash
git add src/game/init.test.ts src/sharing/share-link.test.ts
git commit -m "test(rotation): lock in classic and composable rotation support"
```

---

## Task 8: Final verification

**Files:** None (no edits)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors anywhere.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — every spec green.

- [ ] **Step 3: Manual smoke check pointer**

The plan does not include a manual smoke run, but for the implementer's sanity it is worth opening the dev server (`npm run dev`) and confirming:

1. Open the new-game dialog. The "Enable rotation" row is visible directly under the cut-style picker.
2. Pick **Classic**, tick rotation, pick a size — pieces appear at random 90° rotations and the rotate buttons appear when a piece is tapped.
3. Pick **Composable**, tick rotation, pick a size — same.
4. Pick **Fractal**, tick rotation, pick a size — same as before this PR.
5. Untick rotation → pieces all start at 0° and rotate buttons stay hidden.
6. Refresh; the rotation checkbox remembers its last value.
7. Open Info → "How to Play" → the Rotate bullet now reads "(when rotation is enabled)" rather than "(fractal puzzles with rotation)". The Cut Styles fractal sub-list no longer mentions rotation.

- [ ] **Step 4: No commit needed if everything passes**

If the smoke check turned up issues, stop and either fix them inline (small) or capture them as follow-ups in `BACKLOG.md` (anything beyond a one-line fix).
