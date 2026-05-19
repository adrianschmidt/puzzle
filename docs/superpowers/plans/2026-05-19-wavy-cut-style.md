# Wavy cut style — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the "sine + classic tabs" composable preset into a top-level Wavy cut style with grid-derived parameters, hide Composable from the production new-game dialog while keeping it selectable on dev-deploys, expose Composable via `window.__newComposableGame`, and migrate all four indexed-preference stores (cut style, puzzle size, background colour, merge tolerance) to stable string ids in localStorage.

**Architecture:** Wavy is a thin strategy in `src/game/cut-style-strategies.ts` that calls `generateComposablePuzzle` with parameters derived from `gridSize` — no config is stored on the GameState. Composable visibility is decided by a single `isComposableVisible()` predicate that the cut-style picker consults. The id migration adds a new `createIdPreferenceStore` factory that reads either an id string or a legacy integer index, and writes only ids. The four existing stores swap to it; `legacyOrder` arrays preserve historical integer mappings.

**Tech Stack:** TypeScript, Vitest, Vite. Tests run with `npx vitest run <file>` for a single file, or `npm test` for all.

**See:** `docs/superpowers/specs/2026-05-19-wavy-cut-style-design.md` for the broader design.

---

## File map

**Create:**
- `src/game/cut-style-strategies.test.ts` — Wavy strategy tests (no existing test file for this module).

**Modify (factory + migrations):**
- `src/ui/preference-store.ts` — add `createIdPreferenceStore`.
- `src/ui/preference-store.test.ts` — add factory tests.
- `src/ui/merge-tolerance.ts` — id-keyed presets, switch factory.
- `src/ui/merge-tolerance.test.ts` — id-based assertions.
- `src/ui/background-colour.ts` — id-keyed presets, switch factory.
- `src/ui/background-colour.test.ts` — id-based assertions.
- `src/game/puzzle-sizes.ts` — id-keyed options, switch factory.
- `src/game/puzzle-sizes.test.ts` — id-based assertions.
- `src/game/cut-styles.ts` — id-keyed options, switch factory, add `isComposableVisible`, `getVisibleCutStyleOptions`, add Wavy option.
- `src/game/cut-styles.test.ts` — id-based assertions, Wavy option, visibility filter.

**Modify (Wavy + plumbing):**
- `src/game/cut-style-strategies.ts` — add `wavyStrategy`.
- `src/ui/cut-style-picker.ts` — accept `selectedCutStyleId`; iterate filtered options.
- `src/ui/cut-style-picker.test.ts` — id-based assertions.
- `src/ui/new-game-dialog.ts` — id-based selection; free rotation gated on `'wavy' || 'composable'`; composable section only when Composable is the selected style.
- `src/ui/new-game-dialog.test.ts` — id-based assertions; visibility for wavy.
- `src/main.ts` — pass ids to dialog/picker; widen rotation derivation; add `__newComposableGame` helper; consume id-based loaders.
- `src/sharing/share-link.ts` — `'wavy'` in `c` union and `isValidPayload`.
- `src/sharing/share-link.test.ts` — wavy round-trip.
- `src/ui/info-modal.ts` — Cut Styles section: replace Composable bullet with Wavy bullet, move Free rotation sub-bullet.
- `src/ui/info-modal.test.ts` — Wavy bullet present, Composable absent.
- `src/ui/index.ts` — re-exports follow renames where applicable.

---

## Task 1: Add `createIdPreferenceStore` factory

**Files:**
- Modify: `src/ui/preference-store.ts`
- Test: `src/ui/preference-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/preference-store.test.ts`, after the existing imports add `createIdPreferenceStore` to the import list:

```ts
import {
    createIndexedPreferenceStore,
    createIdPreferenceStore,
    createBooleanPreference,
    createJsonPreference,
    createStringPreference,
} from './preference-store.js';
```

Append at the end of the file:

```ts
describe('createIdPreferenceStore', () => {
    const PRESETS = [
        { id: 'alpha' },
        { id: 'beta' },
        { id: 'gamma' },
    ] as const;
    const KEY = 'test-id-pref';
    const LEGACY_ORDER = ['alpha', 'beta', 'gamma'] as const;

    function makeStore() {
        return createIdPreferenceStore({
            key: KEY,
            presets: PRESETS,
            defaultId: 'beta',
            legacyOrder: LEGACY_ORDER,
        });
    }

    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the preset matching an id', () => {
        expect(makeStore().getPreset('alpha')).toEqual({ id: 'alpha' });
        expect(makeStore().getPreset('gamma')).toEqual({ id: 'gamma' });
    });

    it('returns the default preset for an unknown id', () => {
        expect(makeStore().getPreset('nope')).toEqual({ id: 'beta' });
    });

    it('saves and loads an id', () => {
        const store = makeStore();
        store.save('gamma');
        expect(store.load()).toBe('gamma');
    });

    it('returns the default id when nothing is saved', () => {
        expect(makeStore().load()).toBe('beta');
    });

    it('migrates a legacy integer index to the matching id', () => {
        localStorage.setItem(KEY, '0');
        expect(makeStore().load()).toBe('alpha');
        localStorage.setItem(KEY, '2');
        expect(makeStore().load()).toBe('gamma');
    });

    it('returns the default for an out-of-range legacy integer', () => {
        localStorage.setItem(KEY, '99');
        expect(makeStore().load()).toBe('beta');
        localStorage.setItem(KEY, '-1');
        expect(makeStore().load()).toBe('beta');
    });

    it('returns the default for an unknown saved string', () => {
        localStorage.setItem(KEY, 'not-a-known-id');
        expect(makeStore().load()).toBe('beta');
    });

    it('does NOT rewrite localStorage on load (migration is read-only)', () => {
        localStorage.setItem(KEY, '0');
        makeStore().load();
        expect(localStorage.getItem(KEY)).toBe('0');
    });

    it('overwrites the legacy integer the next time save() is called', () => {
        localStorage.setItem(KEY, '0');
        const store = makeStore();
        expect(store.load()).toBe('alpha');
        store.save('gamma');
        expect(localStorage.getItem(KEY)).toBe('gamma');
    });

    it('survives localStorage errors by returning the default', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage broken');
        });
        expect(makeStore().load()).toBe('beta');
        vi.restoreAllMocks();
    });
});
```

Add `vi` to the imports at the top of the file:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/preference-store.test.ts
```

Expected: failing — `createIdPreferenceStore` is not exported.

- [ ] **Step 3: Implement the factory**

Append to `src/ui/preference-store.ts`:

```ts
/**
 * A store for an id-keyed preset preference: a list of presets carrying
 * stable string ids, plus a persisted id pointing into the list.
 *
 * Reads accept either the new id form or a legacy integer index
 * (translated via `legacyOrder`), so existing saved preferences keep
 * working across the migration. Writes always use the id form, so the
 * legacy form gets overwritten the next time the user changes their
 * preference.
 */
export interface IdPreferenceStore<T extends { id: string }> {
    /** Get the preset whose id matches, or the default preset. */
    getPreset: (id: string) => T;
    /** Persist the preferred id. */
    save: (id: string) => void;
    /** Load the persisted id (always a valid preset id). */
    load: () => string;
}

/**
 * Build an id-keyed preference store backed by `localStorage`.
 *
 * `legacyOrder` captures the pre-migration storage order so a raw
 * value of `'N'` (numeric string) resolves to `legacyOrder[N]`. Drop
 * it in a follow-up release once enough users have loaded the
 * migrated build.
 */
export function createIdPreferenceStore<T extends { id: string }>(opts: {
    key: string;
    presets: readonly T[];
    defaultId: string;
    legacyOrder: readonly string[];
}): IdPreferenceStore<T> {
    const { key, presets, defaultId, legacyOrder } = opts;
    const ids = new Set(presets.map((p) => p.id));

    function defaultPreset(): T {
        return presets.find((p) => p.id === defaultId) ?? presets[0];
    }

    return {
        getPreset(id) {
            return presets.find((p) => p.id === id) ?? defaultPreset();
        },
        save(id) {
            localStorage.setItem(key, id);
        },
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) {
                    return defaultId;
                }

                if (ids.has(raw)) {
                    return raw;
                }

                // Legacy integer-index migration.
                if (/^-?\d+$/.test(raw)) {
                    const idx = parseInt(raw, 10);
                    if (idx >= 0 && idx < legacyOrder.length) {
                        const id = legacyOrder[idx];
                        if (ids.has(id)) {
                            return id;
                        }
                    }
                }

                return defaultId;
            } catch {
                return defaultId;
            }
        },
    };
}
```

- [ ] **Step 4: Run, verify passing**

```bash
npx vitest run src/ui/preference-store.test.ts
```

Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/ui/preference-store.ts src/ui/preference-store.test.ts
git commit -m "feat(preference-store): add id-keyed factory with legacy-index migration"
```

---

## Task 2: Migrate `merge-tolerance.ts` to id-based

Tolerance is the simplest indexed store (3 presets, append-only history). Migrating it first lets us validate the factory's wiring before touching anything more visible.

**Files:**
- Modify: `src/ui/merge-tolerance.ts`
- Modify: `src/ui/merge-tolerance.test.ts`
- Modify: `src/ui/index.ts` (re-exports)

- [ ] **Step 1: Update the test file to expect id-based behaviour**

Replace the entire content of `src/ui/merge-tolerance.test.ts` with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MERGE_TOLERANCE_PRESETS,
    DEFAULT_TOLERANCE_ID,
    TOLERANCE_PREFERENCE_KEY,
    getTolerancePreset,
    saveTolerancePreference,
    loadTolerancePreference,
    getActiveTolerance,
    getActiveRotationTolerance,
    getSortedPresets,
    getReferencePieceWidth,
    getStyleSnapMultiplier,
} from './merge-tolerance.js';

describe('merge-tolerance', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('MERGE_TOLERANCE_PRESETS', () => {
        it('has at least three presets', () => {
            expect(MERGE_TOLERANCE_PRESETS.length).toBeGreaterThanOrEqual(3);
        });

        it('each preset has id, label, description, fraction, rotationDegrees, displayOrder', () => {
            for (const preset of MERGE_TOLERANCE_PRESETS) {
                expect(preset.id).toBeTruthy();
                expect(preset.label).toBeTruthy();
                expect(preset.description).toBeTruthy();
                expect(preset.fraction).toBeGreaterThan(0);
                expect(preset.rotationDegrees).toBeGreaterThan(0);
                expect(typeof preset.displayOrder).toBe('number');
            }
        });

        it('uses stable string ids: strict, forgiving, normal', () => {
            const ids = MERGE_TOLERANCE_PRESETS.map((p) => p.id);
            expect(ids).toEqual(['strict', 'forgiving', 'normal']);
        });

        it('default id points to Normal', () => {
            expect(DEFAULT_TOLERANCE_ID).toBe('normal');
        });
    });

    describe('getSortedPresets', () => {
        it('returns presets in display order: Strict, Normal, Forgiving', () => {
            const sorted = getSortedPresets();
            expect(sorted.map((p) => p.label)).toEqual(['Strict', 'Normal', 'Forgiving']);
        });
    });

    describe('getReferencePieceWidth', () => {
        it('computes imageWidth / cols', () => {
            expect(getReferencePieceWidth(1080, 8)).toBe(135);
        });
    });

    describe('getStyleSnapMultiplier', () => {
        it('returns 1.0 for all known styles', () => {
            expect(getStyleSnapMultiplier('classic')).toBe(1.0);
            expect(getStyleSnapMultiplier('fractal')).toBe(1.0);
            expect(getStyleSnapMultiplier('composable')).toBe(1.0);
        });

        it('returns 1.0 for unknown styles', () => {
            expect(getStyleSnapMultiplier('unknown')).toBe(1.0);
        });
    });

    describe('getTolerancePreset', () => {
        it('returns the preset matching an id', () => {
            expect(getTolerancePreset('strict').label).toBe('Strict');
            expect(getTolerancePreset('forgiving').label).toBe('Forgiving');
            expect(getTolerancePreset('normal').label).toBe('Normal');
        });

        it('returns the default preset for an unknown id', () => {
            expect(getTolerancePreset('nope').label).toBe('Normal');
        });
    });

    describe('saveTolerancePreference / loadTolerancePreference', () => {
        it('returns default id when nothing is saved', () => {
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('saves and loads an id', () => {
            saveTolerancePreference('strict');
            expect(loadTolerancePreference()).toBe('strict');
        });

        it('migrates legacy integer indices to ids', () => {
            // Pre-migration order: strict=0, forgiving=1, normal=2.
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '0');
            expect(loadTolerancePreference()).toBe('strict');
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '1');
            expect(loadTolerancePreference()).toBe('forgiving');
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '2');
            expect(loadTolerancePreference()).toBe('normal');
        });

        it('returns default for unknown stored values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, 'garbage');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('returns default for out-of-range legacy values', () => {
            localStorage.setItem(TOLERANCE_PREFERENCE_KEY, '99');
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
        });

        it('handles localStorage errors gracefully', () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('storage error');
            });
            expect(loadTolerancePreference()).toBe(DEFAULT_TOLERANCE_ID);
            vi.restoreAllMocks();
        });
    });

    describe('getActiveTolerance', () => {
        it('computes tolerance for the default preset', () => {
            // Normal: fraction 0.333, 1080/8 = 135 → ~45
            const tolerance = getActiveTolerance(1080, 8);
            expect(tolerance).toBeCloseTo(0.333 * 135, 1);
        });

        it('computes tolerance for Strict when saved', () => {
            saveTolerancePreference('strict');
            expect(getActiveTolerance(1080, 8)).toBeCloseTo(0.133 * 135, 1);
        });

        it('computes tolerance for Forgiving when saved', () => {
            saveTolerancePreference('forgiving');
            expect(getActiveTolerance(1080, 8)).toBeCloseTo(0.533 * 135, 1);
        });
    });

    describe('getActiveRotationTolerance', () => {
        it('returns 20 for the default Normal preset', () => {
            expect(getActiveRotationTolerance()).toBe(20);
        });

        it('returns 10 for Strict', () => {
            saveTolerancePreference('strict');
            expect(getActiveRotationTolerance()).toBe(10);
        });

        it('returns 40 for Forgiving', () => {
            saveTolerancePreference('forgiving');
            expect(getActiveRotationTolerance()).toBe(40);
        });
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/merge-tolerance.test.ts
```

Expected: failing — `DEFAULT_TOLERANCE_ID` not exported, `preset.id` undefined, etc.

- [ ] **Step 3: Migrate the source**

Replace the entire content of `src/ui/merge-tolerance.ts` with:

```ts
/**
 * Merge tolerance presets and persistence.
 *
 * Controls how close pieces need to be before they snap together.
 * Tolerance is expressed as a fraction of the reference piece width
 * (imageWidth / cols), so it feels consistent regardless of puzzle
 * size or image resolution.
 *
 * Storage format: each preset has a stable string `id` written to
 * localStorage. Legacy integer indices (pre-migration:
 * 0=strict, 1=forgiving, 2=normal) still load via the
 * `createIdPreferenceStore` factory's legacy-order translation.
 */

import type { CutStyle } from '../game/cut-styles.js';
import { createIdPreferenceStore } from './preference-store.js';

/**
 * A merge tolerance preset.
 */
export interface MergeTolerancePreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label */
    label: string;
    /** Description shown to the player */
    description: string;
    /** Tolerance as a fraction of the reference piece width. */
    fraction: number;
    /**
     * Maximum angular misalignment (in degrees) at which two free-rotation
     * groups can still merge. In quarter-turn mode the rotations are always
     * exactly equal, so this value is effectively a no-op there.
     */
    rotationDegrees: number;
    /** Sort order for display in the UI (lowest first). */
    displayOrder: number;
}

/**
 * Available merge tolerance presets.
 *
 * Array order matches the pre-migration storage indices so the
 * legacy-index loader translates correctly. New presets can be
 * appended freely now that storage is id-keyed.
 */
export const MERGE_TOLERANCE_PRESETS: readonly MergeTolerancePreset[] = [
    {
        id: 'strict',
        label: 'Strict',
        description: 'Pieces must be very close to snap',
        fraction: 0.133,
        rotationDegrees: 10,
        displayOrder: 0,
    },
    {
        id: 'forgiving',
        label: 'Forgiving',
        description: 'Pieces snap from further away',
        fraction: 0.533,
        rotationDegrees: 40,
        displayOrder: 2,
    },
    {
        id: 'normal',
        label: 'Normal',
        description: 'Standard snapping distance',
        fraction: 0.333,
        rotationDegrees: 20,
        displayOrder: 1,
    },
] as const;

/** Default preset id. */
export const DEFAULT_TOLERANCE_ID = 'normal';

/**
 * Pre-migration storage order — DO NOT reorder. Used by the loader to
 * translate legacy integer indices to ids. Drop in a follow-up release
 * once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = ['strict', 'forgiving', 'normal'] as const;

/**
 * Return the presets sorted by `displayOrder`, ready for rendering.
 */
export function getSortedPresets(): readonly MergeTolerancePreset[] {
    return [...MERGE_TOLERANCE_PRESETS].sort(
        (a, b) => a.displayOrder - b.displayOrder,
    );
}

/** localStorage key for the saved merge tolerance preference. */
export const TOLERANCE_PREFERENCE_KEY = 'puzzle-merge-tolerance';

const store = createIdPreferenceStore({
    key: TOLERANCE_PREFERENCE_KEY,
    presets: MERGE_TOLERANCE_PRESETS,
    defaultId: DEFAULT_TOLERANCE_ID,
    legacyOrder: LEGACY_ORDER,
});

/** Get the preset for an id, or the default preset for an unknown id. */
export const getTolerancePreset = store.getPreset;

/** Save the preferred merge tolerance id to localStorage. */
export const saveTolerancePreference = store.save;

/** Load the preferred merge tolerance id from localStorage. */
export const loadTolerancePreference = store.load;

/**
 * Per-style snap distance multiplier.
 *
 * Applied on top of the preset fraction to allow each puzzle style
 * to feel right without exposing extra UI to the player.
 * Default is 1.0 for all styles; tweak as needed.
 */
const STYLE_SNAP_MULTIPLIERS: Record<string, number> = {
    classic: 1.0,
    fractal: 1.0,
    composable: 1.0,
};

/**
 * Get the snap distance multiplier for a given cut style.
 */
export function getStyleSnapMultiplier(style: CutStyle | string): number {
    return STYLE_SNAP_MULTIPLIERS[style] ?? 1.0;
}

/**
 * Compute the reference piece width for snap distance calculation.
 */
export function getReferencePieceWidth(
    imageWidth: number,
    cols: number,
): number {
    return imageWidth / cols;
}

/**
 * Get the current merge tolerance in pixels.
 */
export function getActiveTolerance(
    imageWidth: number,
    cols: number,
    cutStyle: CutStyle | string = 'classic',
): number {
    const preset = getTolerancePreset(loadTolerancePreference());
    const pieceWidth = getReferencePieceWidth(imageWidth, cols);
    const styleMultiplier = getStyleSnapMultiplier(cutStyle);
    return preset.fraction * pieceWidth * styleMultiplier;
}

/**
 * Get the current merge rotation tolerance in degrees.
 */
export function getActiveRotationTolerance(): number {
    return getTolerancePreset(loadTolerancePreference()).rotationDegrees;
}
```

- [ ] **Step 4: Update info-modal call site that depended on `storageIndex`**

Find call site:

```bash
grep -n "getSortedPresets\|storageIndex" src/ui/info-modal.ts
```

Replace the relevant lines (currently around `src/ui/info-modal.ts:237-266`) so the loop iterates plain presets and uses `preset.id`:

```ts
    const currentToleranceId = loadTolerancePreference();
    getSortedPresets().forEach((preset) => {
        const button = document.createElement('button');
        button.className = 'tolerance-option';
        button.type = 'button';
        button.dataset.testid = `tolerance-${preset.label.toLowerCase()}`;
        if (preset.id === currentToleranceId) {
            button.classList.add('selected');
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'tolerance-option-label';
        labelSpan.textContent = preset.label;
        button.appendChild(labelSpan);

        const descSpan = document.createElement('span');
        descSpan.className = 'tolerance-option-desc';
        descSpan.textContent = preset.description;
        button.appendChild(descSpan);

        button.addEventListener('click', () => {
            saveTolerancePreference(preset.id);
            tolContainer
                .querySelectorAll('.tolerance-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
            onToleranceChanged?.(preset.id);
        });

        tolContainer.appendChild(button);
    });
```

Also update the `onToleranceChanged` callback signature in `src/ui/info-modal.ts` near the top:

```ts
    /** Called when the merge tolerance preference changes. */
    onToleranceChanged?: (id: string) => void;
```

- [ ] **Step 5: Update other call sites that pass tolerance index**

```bash
grep -rn "saveTolerancePreference\|loadTolerancePreference\|onToleranceChanged" src/
```

Update each call site so an id (`string`) is passed instead of an index (`number`). The only producer outside `info-modal.ts` is `main.ts`; check that no consumer expects a numeric index — `onToleranceChanged` in main.ts currently does nothing with its argument (see `src/main.ts` where `createInfoModal` is called), so it just needs to accept the new type.

If `main.ts` declares a typed handler, change its parameter type from `number` to `string`. No behavioural change beyond the type.

- [ ] **Step 6: Update `src/ui/index.ts` re-exports**

Change the merge-tolerance re-export block (around line 100):

```ts
export {
    MERGE_TOLERANCE_PRESETS,
    DEFAULT_TOLERANCE_ID,
    getTolerancePreset,
    saveTolerancePreference,
    loadTolerancePreference,
    getActiveTolerance,
    getActiveRotationTolerance,
} from './merge-tolerance.js';
export type { MergeTolerancePreset } from './merge-tolerance.js';
```

(Remove any export of the old `DEFAULT_TOLERANCE_INDEX` from this file if present.)

- [ ] **Step 7: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass. If `merge-tolerance.test.ts` or `info-modal.test.ts` still references `DEFAULT_TOLERANCE_INDEX` or `storageIndex`, update those references inline.

- [ ] **Step 8: Commit**

```bash
git add src/ui/merge-tolerance.ts src/ui/merge-tolerance.test.ts src/ui/info-modal.ts src/ui/index.ts
git commit -m "refactor(merge-tolerance): id-keyed storage with legacy-index migration"
```

---

## Task 3: Migrate `background-colour.ts` to id-based

**Files:**
- Modify: `src/ui/background-colour.ts`
- Modify: `src/ui/background-colour.test.ts`
- Modify: `src/ui/index.ts`
- Modify: `src/ui/background-colour-picker.ts` (and its test) — switches from index to id.
- Modify: `src/main.ts` — colour-picker callback.

- [ ] **Step 1: Update the colour test file**

Replace the contents of `src/ui/background-colour.test.ts` with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_ID,
    COLOUR_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getColourPreset,
    saveColourPreference,
    loadColourPreference,
    applyBackgroundColour,
    isLightColour,
} from './background-colour.js';

describe('BACKGROUND_COLOUR_PRESETS', () => {
    it('has at least 3 presets', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBeGreaterThanOrEqual(3);
    });

    it('each preset has id, label, and colour', () => {
        for (const preset of BACKGROUND_COLOUR_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.label).toBeTruthy();
            expect(preset.colour).toBeTruthy();
        }
    });

    it('first preset is Midnight (id "midnight", the original default)', () => {
        expect(BACKGROUND_COLOUR_PRESETS[0].label).toBe('Midnight');
        expect(BACKGROUND_COLOUR_PRESETS[0].id).toBe('midnight');
        expect(DEFAULT_COLOUR_ID).toBe('midnight');
    });
});

describe('getColourPreset', () => {
    it('returns the preset matching an id', () => {
        expect(getColourPreset('midnight').label).toBe('Midnight');
        expect(getColourPreset('charcoal').label).toBe('Charcoal');
    });

    it('returns the default preset for an unknown id', () => {
        expect(getColourPreset('not-a-colour').label).toBe('Midnight');
    });
});

describe('saveColourPreference / loadColourPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads an id', () => {
        saveColourPreference('slate');
        expect(loadColourPreference()).toBe('slate');
    });

    it('returns the default when nothing is saved', () => {
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('returns the default for an unknown saved value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'garbage');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('migrates legacy integer indices to ids', () => {
        // Pre-migration order: midnight=0, charcoal=1, slate=2, ...
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '1');
        expect(loadColourPreference()).toBe('charcoal');
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '5');
        expect(loadColourPreference()).toBe('green-felt');
    });

    it('returns the default for out-of-range legacy values', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '99');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '-1');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('isLightColour', () => {
    it('identifies white as light', () => {
        expect(isLightColour('#ffffff')).toBe(true);
    });

    it('identifies pastel blush as light', () => {
        expect(isLightColour('#f5e0e0')).toBe(true);
    });

    it('identifies midnight as dark', () => {
        expect(isLightColour('#1a1a2e')).toBe(false);
    });

    it('identifies hot pink as dark', () => {
        expect(isLightColour('#ff1493')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
        delete document.documentElement.dataset.uiScheme;
    });

    it('sets the CSS custom property on the document root', () => {
        applyBackgroundColour('midnight');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#1a1a2e');
    });

    it('sets the body background-color', () => {
        applyBackgroundColour('midnight');
        expect(document.body.style.backgroundColor).toBeTruthy();
    });

    it('applies a different colour for a different id', () => {
        applyBackgroundColour('slate');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#4a5568');
    });

    it('falls back to default for an unknown id', () => {
        applyBackgroundColour('not-a-colour');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#1a1a2e');
    });

    it('sets data-ui-scheme="light" for a light pastel preset', () => {
        applyBackgroundColour('blush');
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });

    it('sets data-ui-scheme="dark" for midnight', () => {
        applyBackgroundColour('midnight');
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/background-colour.test.ts
```

Expected: failing.

- [ ] **Step 3: Migrate the source**

Replace `src/ui/background-colour.ts` with:

```ts
/**
 * Background colour presets and persistence.
 *
 * Provides a set of preset background colours for the puzzle table,
 * and saves/loads the player's choice from localStorage by stable id.
 * Legacy integer indices migrate via `createIdPreferenceStore`.
 */

import { createIdPreferenceStore } from './preference-store.js';

/**
 * A background colour preset.
 */
export interface BackgroundColourPreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label, e.g. "Midnight" */
    label: string;
    /** CSS colour value */
    colour: string;
}

/**
 * Available background colour presets.
 *
 * Array order matches the pre-migration storage indices so the
 * legacy-index loader translates correctly. New presets can be
 * appended freely now that storage is id-keyed.
 */
export const BACKGROUND_COLOUR_PRESETS: readonly BackgroundColourPreset[] = [
    { id: 'midnight',   label: 'Midnight',   colour: '#1a1a2e' },
    { id: 'charcoal',   label: 'Charcoal',   colour: '#2d2d2d' },
    { id: 'slate',      label: 'Slate',      colour: '#4a5568' },
    { id: 'light',      label: 'Light',      colour: '#d4d4d4' },
    { id: 'wood',       label: 'Wood',       colour: '#5c4033' },
    { id: 'green-felt', label: 'Green felt', colour: '#2e5f3e' },
    { id: 'hot-pink',   label: 'Hot pink',   colour: '#ff1493' },
    { id: 'blush',      label: 'Blush',      colour: '#f5e0e0' },
    { id: 'peach',      label: 'Peach',      colour: '#fde8d0' },
    { id: 'sage',       label: 'Sage',       colour: '#ddeedd' },
    { id: 'sky',        label: 'Sky',        colour: '#ddeeff' },
    { id: 'lavender',   label: 'Lavender',   colour: '#e8e0f0' },
] as const;

/** Default preset id (Midnight — the original default). */
export const DEFAULT_COLOUR_ID = 'midnight';

/** localStorage key for the saved background colour. */
export const COLOUR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-colour';

/**
 * Pre-migration storage order — DO NOT reorder. Drop in a follow-up
 * release once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = BACKGROUND_COLOUR_PRESETS.map((p) => p.id);

const store = createIdPreferenceStore({
    key: COLOUR_PREFERENCE_KEY,
    presets: BACKGROUND_COLOUR_PRESETS,
    defaultId: DEFAULT_COLOUR_ID,
    legacyOrder: LEGACY_ORDER,
});

export const getColourPreset = store.getPreset;
export const saveColourPreference = store.save;
export const loadColourPreference = store.load;

/**
 * Determine whether a hex colour is perceptually light
 * (relative luminance > 0.4).
 */
export function isLightColour(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4;
}

/**
 * Apply a background colour to the document root via CSS custom property.
 */
export function applyBackgroundColour(id: string): void {
    const preset = getColourPreset(id);
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    document.body.style.backgroundColor = preset.colour;
    document.documentElement.dataset.uiScheme = isLightColour(preset.colour)
        ? 'light'
        : 'dark';
}
```

- [ ] **Step 4: Update the background-colour-picker component**

Open `src/ui/background-colour-picker.ts`. Look at the options type and onSelect call. Change every `selectedIndex: number` / `index: number` to `selectedId: string` / `id: string`. The picker iterates `BACKGROUND_COLOUR_PRESETS` and assigns selection by matching `preset.id === selectedId`.

```bash
grep -n "selectedIndex\|onSelect" src/ui/background-colour-picker.ts
```

Walk through each occurrence and replace it. Then run the picker's own test:

```bash
npx vitest run src/ui/background-colour-picker.test.ts
```

If the existing tests still pass with the new signature (i.e. they didn't depend on indices), great. Otherwise update them — replace each numeric argument with the matching preset id.

- [ ] **Step 5: Update `src/main.ts` call sites**

```bash
grep -n "applyBackgroundColour\|saveColourPreference\|loadColourPreference\|initialColourIndex" src/main.ts
```

Replace `initialColourIndex` with `initialColourId`. Where the existing code does
`applyBackgroundColour(initialColourIndex)`, pass the id instead. The `createBackgroundColourPicker` `selectedIndex`/`onSelect(index)` signature changes to id-based.

Concretely, the block in main.ts that initialises the colour picker becomes:

```ts
const initialColourId = loadColourPreference();
applyBackgroundColour(initialColourId);

createBackgroundColourPicker({
    container: app,
    selectedId: initialColourId,
    onSelect: (id) => {
        saveColourPreference(id);
        applyBackgroundColour(id);
    },
});
```

- [ ] **Step 6: Update `src/ui/index.ts` re-exports**

Update the background-colour re-export block:

```ts
export {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_ID,
    getColourPreset,
    saveColourPreference,
    loadColourPreference,
    applyBackgroundColour,
} from './background-colour.js';
export type { BackgroundColourPreset } from './background-colour.js';
```

(Remove `DEFAULT_COLOUR_INDEX` from the export list if present.)

- [ ] **Step 7: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass. Address any test that still expects the old index-based API by switching it to ids.

- [ ] **Step 8: Commit**

```bash
git add src/ui/background-colour.ts src/ui/background-colour.test.ts src/ui/background-colour-picker.ts src/ui/background-colour-picker.test.ts src/ui/index.ts src/main.ts
git commit -m "refactor(background-colour): id-keyed storage with legacy-index migration"
```

---

## Task 4: Migrate `puzzle-sizes.ts` to id-based

**Files:**
- Modify: `src/game/puzzle-sizes.ts`
- Modify: `src/game/puzzle-sizes.test.ts`
- Modify: `src/ui/new-game-dialog.ts` — selection payload uses `sizeId` instead of `sizeIndex`.
- Modify: `src/ui/new-game-dialog.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update the puzzle-sizes test file**

Replace `src/game/puzzle-sizes.test.ts` with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PUZZLE_SIZE_OPTIONS,
    DEFAULT_SIZE_ID,
    SIZE_PREFERENCE_KEY,
    getSizeOption,
    toGridSize,
    findSizeId,
    saveSizePreference,
    loadSizePreference,
} from './puzzle-sizes.js';

describe('PUZZLE_SIZE_OPTIONS', () => {
    it('has 4 size options', () => {
        expect(PUZZLE_SIZE_OPTIONS).toHaveLength(4);
    });

    it('each option has correct pieceCount = cols × rows', () => {
        for (const opt of PUZZLE_SIZE_OPTIONS) {
            expect(opt.pieceCount).toBe(opt.cols * opt.rows);
        }
    });

    it('is sorted from smallest to largest', () => {
        for (let i = 1; i < PUZZLE_SIZE_OPTIONS.length; i++) {
            expect(PUZZLE_SIZE_OPTIONS[i].pieceCount).toBeGreaterThan(
                PUZZLE_SIZE_OPTIONS[i - 1].pieceCount,
            );
        }
    });

    it('uses pieceCount string as the id', () => {
        const ids = PUZZLE_SIZE_OPTIONS.map((o) => o.id);
        expect(ids).toEqual(['24', '48', '96', '192']);
    });

    it('default id is "48"', () => {
        expect(DEFAULT_SIZE_ID).toBe('48');
    });
});

describe('getSizeOption', () => {
    it('returns the option matching an id', () => {
        expect(getSizeOption('24').pieceCount).toBe(24);
        expect(getSizeOption('96').pieceCount).toBe(96);
    });

    it('returns the default for an unknown id', () => {
        const opt = getSizeOption('not-a-size');
        expect(opt.pieceCount).toBe(48);
    });
});

describe('toGridSize', () => {
    it('converts a size option to a GridSize', () => {
        const opt = getSizeOption('96');
        expect(toGridSize(opt)).toEqual({ cols: 12, rows: 8 });
    });
});

describe('findSizeId', () => {
    it('finds the id for a known grid size', () => {
        expect(findSizeId({ cols: 8, rows: 6 })).toBe('48');
    });

    it('returns undefined for an unknown grid size', () => {
        expect(findSizeId({ cols: 10, rows: 10 })).toBeUndefined();
    });
});

describe('saveSizePreference / loadSizePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads an id', () => {
        saveSizePreference('96');
        expect(loadSizePreference()).toBe('96');
    });

    it('returns default when nothing is saved', () => {
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });

    it('migrates legacy integer indices to ids', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '0');
        expect(loadSizePreference()).toBe('24');
        localStorage.setItem(SIZE_PREFERENCE_KEY, '2');
        expect(loadSizePreference()).toBe('96');
    });

    it('returns default for unknown stored values', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, 'garbage');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });

    it('returns default for out-of-range legacy values', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '99');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
        localStorage.setItem(SIZE_PREFERENCE_KEY, '-1');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/puzzle-sizes.test.ts
```

Expected: failing.

- [ ] **Step 3: Migrate the source**

Replace `src/game/puzzle-sizes.ts` with:

```ts
/**
 * Puzzle size options and persistence.
 *
 * Each option carries a stable string `id` (the piece count as a
 * string). Legacy integer indices migrate via the id-keyed factory.
 */

import type { GridSize } from '../model/types.js';
import { createIdPreferenceStore } from '../ui/preference-store.js';

/**
 * A selectable puzzle size option.
 */
export interface PuzzleSizeOption {
    /** Stable string id (the piece count as a string). */
    id: string;
    /** Display label, e.g. "48 pieces" */
    label: string;
    /** Total number of pieces */
    pieceCount: number;
    /** Grid columns */
    cols: number;
    /** Grid rows */
    rows: number;
}

/**
 * Available puzzle size options.
 * Array order matches the pre-migration storage indices.
 */
export const PUZZLE_SIZE_OPTIONS: readonly PuzzleSizeOption[] = [
    { id: '24',  label: '24 pieces',  pieceCount: 24,  cols: 6,  rows: 4 },
    { id: '48',  label: '48 pieces',  pieceCount: 48,  cols: 8,  rows: 6 },
    { id: '96',  label: '96 pieces',  pieceCount: 96,  cols: 12, rows: 8 },
    { id: '192', label: '192 pieces', pieceCount: 192, cols: 16, rows: 12 },
] as const;

/** Default size id (48 pieces — the original default). */
export const DEFAULT_SIZE_ID = '48';

/** localStorage key for the saved size preference. */
export const SIZE_PREFERENCE_KEY = 'puzzle-size-preference';

/**
 * Pre-migration storage order — DO NOT reorder. Drop in a follow-up
 * release once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = PUZZLE_SIZE_OPTIONS.map((o) => o.id);

const store = createIdPreferenceStore({
    key: SIZE_PREFERENCE_KEY,
    presets: PUZZLE_SIZE_OPTIONS,
    defaultId: DEFAULT_SIZE_ID,
    legacyOrder: LEGACY_ORDER,
});

/** Get the option for an id, or the default option. */
export const getSizeOption = store.getPreset;

/** Convert a PuzzleSizeOption to a GridSize. */
export function toGridSize(option: PuzzleSizeOption): GridSize {
    return { cols: option.cols, rows: option.rows };
}

/**
 * Find the id of the option matching the given grid size.
 * Returns undefined if no match is found.
 */
export function findSizeId(gridSize: GridSize): string | undefined {
    return PUZZLE_SIZE_OPTIONS.find(
        (opt) => opt.cols === gridSize.cols && opt.rows === gridSize.rows,
    )?.id;
}

export const saveSizePreference = store.save;
export const loadSizePreference = store.load;
```

- [ ] **Step 4: Update `src/ui/new-game-dialog.ts`**

The dialog currently passes `sizeIndex: number` in `NewGameSelection` and accepts `selectedIndex: number` in `NewGameDialogOptions`. Change to ids:

- In `NewGameSelection`: rename `sizeIndex: number` → `sizeId: string`.
- In `NewGameDialogOptions`: rename `selectedIndex: number` → `selectedSizeId: string`.
- Rename `NewGameDialogOptions.selectedIndex: number` → `selectedSizeId: string` and `NewGameSelection.sizeIndex: number` → `sizeId: string`.
- Inside `buildSizeSection`, replace the `selectedIndex` parameter with `selectedSizeId`. Iterate `PUZZLE_SIZE_OPTIONS`, mark `btn.classList.add('size-picker-option--selected')` when `opt.id === selectedSizeId`, and fire `args.onPick(opt.id)` on click.
- Keep the `getCutStyleIndex` callback intact for now — Task 5 migrates the cut-style side. `updateLabels` still computes `isFractal` via `CUT_STYLE_OPTIONS[args.getCutStyleIndex()].id === 'fractal'`.

Concrete diff inside `buildSizeSection` (around `src/ui/new-game-dialog.ts:116-176`):

```ts
function buildSizeSection(args: {
    selectedSizeId: string;
    getCutStyleIndex: () => number;
    onPick: (sizeId: string) => void;
}): SizeSection {
    const grid = document.createElement('div');
    grid.className = 'size-picker-grid';

    const buttons: HTMLButtonElement[] = [];

    for (const opt of PUZZLE_SIZE_OPTIONS) {
        const btn = document.createElement('button');
        btn.className = `size-picker-option size-picker-option--${getSizeClass(opt.pieceCount)}`;
        btn.type = 'button';
        btn.dataset.sizeId = opt.id;

        if (opt.id === args.selectedSizeId) {
            btn.classList.add('size-picker-option--selected');
        }

        btn.addEventListener('click', () => args.onPick(opt.id));

        buttons.push(btn);
        grid.appendChild(btn);
    }

    function updateLabels(): void {
        const isFractal =
            CUT_STYLE_OPTIONS[args.getCutStyleIndex()].id === 'fractal';
        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const opt = PUZZLE_SIZE_OPTIONS[i];
            btn.replaceChildren();

            const count = document.createElement('span');
            count.className = 'size-picker-count';
            count.textContent = isFractal ? `~${opt.pieceCount}` : String(opt.pieceCount);

            const label = document.createElement('span');
            label.className = 'size-picker-label';
            label.textContent = 'pieces';

            btn.appendChild(count);
            btn.appendChild(label);

            if (!isFractal) {
                const dims = document.createElement('span');
                dims.className = 'size-picker-dims';
                dims.textContent = `${opt.cols} × ${opt.rows}`;
                btn.appendChild(dims);
            }
        }
    }

    updateLabels();
    return { element: grid, updateLabels };
}
```

In `createNewGameDialog`, the size-section's `onPick` callback receives a `sizeId` string. Update the `onSelect` payload assembly to pass `sizeId` instead of `sizeIndex`. Keep `cutStyleIndex` and all other cut-style fields exactly as they are — Task 5 migrates them.

- [ ] **Step 5: Update `src/ui/new-game-dialog.test.ts`**

Change every `selectedIndex: 1` → `selectedSizeId: '48'`, every `sizeIndex: 3` → `sizeId: '192'`, and verify clicks resolve based on `dataset.sizeId` rather than DOM order. Run the file:

```bash
npx vitest run src/ui/new-game-dialog.test.ts
```

Fix any remaining test that's affected.

- [ ] **Step 6: Update `src/main.ts` call sites**

```bash
grep -n "loadSizePreference\|saveSizePreference\|getSizeOption\|findSizeIndex\|sizeIndex" src/main.ts
```

Wherever main.ts loaded a numeric index and passed it as `selectedIndex` to the dialog, switch to id:

```ts
const preferredSizeId = loadSizePreference();
// later...
createNewGameDialog({
    container: app,
    selectedSizeId: preferredSizeId,
    // ... unchanged for now ...
});
```

In the dialog's `onSelect` handler, replace destructuring of `sizeIndex` with `sizeId`, and resolve the option via `getSizeOption(sizeId)` instead of by index. Save the id with `saveSizePreference(sizeId)`.

- [ ] **Step 7: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/game/puzzle-sizes.ts src/game/puzzle-sizes.test.ts src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/main.ts
git commit -m "refactor(puzzle-sizes): id-keyed storage with legacy-index migration"
```

---

## Task 5: Migrate `cut-styles.ts` to id-based (no Wavy yet)

This swaps the cut-style preference to id-based and updates the picker / dialog / main wiring. **Wavy is not added in this task** — keeping that change isolated makes the diff easier to review.

**Files:**
- Modify: `src/game/cut-styles.ts`
- Modify: `src/game/cut-styles.test.ts`
- Modify: `src/ui/cut-style-picker.ts`
- Modify: `src/ui/cut-style-picker.test.ts`
- Modify: `src/ui/new-game-dialog.ts` (now finishes the dialog migration)
- Modify: `src/ui/new-game-dialog.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update `src/game/cut-styles.test.ts`**

Replace with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CUT_STYLE_OPTIONS,
    DEFAULT_CUT_STYLE_ID,
    CUT_STYLE_PREFERENCE_KEY,
    getCutStyleOption,
    saveCutStylePreference,
    loadCutStylePreference,
} from './cut-styles.js';

describe('CUT_STYLE_OPTIONS', () => {
    it('has at least two options', () => {
        expect(CUT_STYLE_OPTIONS.length).toBeGreaterThanOrEqual(2);
    });

    it('includes classic, fractal, composable', () => {
        const ids = CUT_STYLE_OPTIONS.map((o) => o.id);
        expect(ids).toContain('classic');
        expect(ids).toContain('fractal');
        expect(ids).toContain('composable');
    });

    it('default id is "classic"', () => {
        expect(DEFAULT_CUT_STYLE_ID).toBe('classic');
    });
});

describe('getCutStyleOption', () => {
    it('returns the option matching an id', () => {
        expect(getCutStyleOption('classic').id).toBe('classic');
        expect(getCutStyleOption('fractal').id).toBe('fractal');
    });

    it('returns the default for an unknown id', () => {
        expect(getCutStyleOption('not-a-style').id).toBe('classic');
    });
});

describe('saveCutStylePreference / loadCutStylePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns default when nothing is saved', () => {
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_ID);
    });

    it('round-trips an id', () => {
        saveCutStylePreference('fractal');
        expect(loadCutStylePreference()).toBe('fractal');
    });

    it('migrates legacy integer indices to ids', () => {
        // Pre-migration order: classic=0, fractal=1, composable=2.
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '0');
        expect(loadCutStylePreference()).toBe('classic');
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '1');
        expect(loadCutStylePreference()).toBe('fractal');
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '2');
        expect(loadCutStylePreference()).toBe('composable');
    });

    it('returns default for unknown stored values', () => {
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, 'garbage');
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_ID);
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/cut-styles.test.ts
```

Expected: failing.

- [ ] **Step 3: Migrate the source**

Replace `src/game/cut-styles.ts` with:

```ts
/**
 * Cut style options and preference persistence.
 *
 * Each option carries a stable string id used in localStorage.
 * Legacy integer indices migrate via the id-keyed factory.
 */

import { createIdPreferenceStore } from '../ui/preference-store.js';

/**
 * Identifier for a cut style generator.
 */
export type CutStyle = 'classic' | 'fractal' | 'composable';

/**
 * A selectable cut style option.
 */
export interface CutStyleOption {
    id: CutStyle;
    label: string;
    description: string;
}

/**
 * Available cut style options.
 *
 * Array order matches the pre-migration storage indices so the
 * legacy-index loader translates correctly.
 */
export const CUT_STYLE_OPTIONS: readonly CutStyleOption[] = [
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional jigsaw tabs',
    },
    {
        id: 'fractal',
        label: 'Fractal',
        description: 'Organic circle-packing',
    },
    {
        id: 'composable',
        label: 'Composable',
        description: 'Experimental — customizable cuts',
    },
] as const;

/** Default cut style id. */
export const DEFAULT_CUT_STYLE_ID: CutStyle = 'classic';

/** localStorage key for the saved cut style preference. */
export const CUT_STYLE_PREFERENCE_KEY = 'puzzle-cut-style';

/**
 * Pre-migration storage order — DO NOT reorder. Drop in a follow-up
 * release once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = ['classic', 'fractal', 'composable'] as const;

const store = createIdPreferenceStore({
    key: CUT_STYLE_PREFERENCE_KEY,
    presets: CUT_STYLE_OPTIONS,
    defaultId: DEFAULT_CUT_STYLE_ID,
    legacyOrder: LEGACY_ORDER,
});

export const getCutStyleOption = store.getPreset;
export const saveCutStylePreference = store.save;
export const loadCutStylePreference = store.load;
```

- [ ] **Step 4: Update the cut-style-picker**

Replace `src/ui/cut-style-picker.ts` with:

```ts
/**
 * Cut style picker — lets the player choose the puzzle cut style.
 *
 * Renders one button per provided option (the caller decides which
 * options to show — see `getVisibleCutStyleOptions()` in
 * `cut-styles.ts` once that helper is added).
 */

import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';
import type { CutStyleOption } from '../game/cut-styles.js';

export interface CutStylePickerOptions {
    /** Currently selected cut style id. */
    selectedCutStyleId: string;
    /** Options to render. Defaults to all known options. */
    options?: readonly CutStyleOption[];
    /** Called when the player selects a style. Receives the option id. */
    onSelect: (id: string) => void;
}

/**
 * Create the cut style picker section (title + option buttons).
 */
export function createCutStylePicker(opts: CutStylePickerOptions): HTMLElement {
    const { selectedCutStyleId, onSelect } = opts;
    const options = opts.options ?? CUT_STYLE_OPTIONS;

    const section = document.createElement('div');
    section.className = 'cut-style-section';

    const title = document.createElement('h3');
    title.className = 'cut-style-title';
    title.textContent = 'Cut Style';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cut-style-grid';

    const buttons: HTMLButtonElement[] = [];

    for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'cut-style-option';
        btn.type = 'button';
        btn.dataset.cutStyleId = opt.id;

        if (opt.id === selectedCutStyleId) {
            btn.classList.add('cut-style-option--selected');
        }

        const label = document.createElement('span');
        label.className = 'cut-style-label';
        label.textContent = opt.label;

        const desc = document.createElement('span');
        desc.className = 'cut-style-desc';
        desc.textContent = opt.description;

        btn.appendChild(label);
        btn.appendChild(desc);

        btn.addEventListener('click', () => {
            for (const b of buttons) {
                b.classList.remove('cut-style-option--selected');
            }
            btn.classList.add('cut-style-option--selected');
            onSelect(opt.id);
        });

        buttons.push(btn);
        grid.appendChild(btn);
    }

    section.appendChild(grid);
    return section;
}
```

Update `src/ui/cut-style-picker.test.ts` to pass `selectedCutStyleId` and expect `onSelect` to be called with an id. Replace the existing file with:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { createCutStylePicker } from './cut-style-picker.js';
import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

describe('createCutStylePicker', () => {
    it('renders one button per option', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons).toHaveLength(CUT_STYLE_OPTIONS.length);
    });

    it('renders only the provided options when given an explicit list', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            options: [CUT_STYLE_OPTIONS[0], CUT_STYLE_OPTIONS[1]],
            onSelect: vi.fn(),
        });
        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons).toHaveLength(2);
    });

    it('marks the selected option', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'fractal',
            onSelect: vi.fn(),
        });
        const buttons = section.querySelectorAll('.cut-style-option');
        const fractalBtn = section.querySelector(
            '[data-cut-style-id="fractal"]',
        ) as HTMLElement;
        expect(fractalBtn.classList.contains('cut-style-option--selected')).toBe(true);
        const classicBtn = section.querySelector(
            '[data-cut-style-id="classic"]',
        ) as HTMLElement;
        expect(classicBtn.classList.contains('cut-style-option--selected')).toBe(false);
        // sanity: at least 2 buttons rendered
        expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it('calls onSelect with the option id when clicked', () => {
        const onSelect = vi.fn();
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            onSelect,
        });
        const btn = section.querySelector(
            '[data-cut-style-id="fractal"]',
        ) as HTMLButtonElement;
        btn.click();
        expect(onSelect).toHaveBeenCalledWith('fractal');
    });
});
```

- [ ] **Step 5: Update `src/ui/new-game-dialog.ts`**

The dialog still references `selectedCutStyleIndex`, `currentCutStyleIndex`, `composableCutIndex`, `fractalCutIndex`, plus the `getCutStyleIndex` callback that `buildSizeSection` uses. Switch to ids throughout:

- `NewGameDialogOptions.selectedCutStyleIndex?: number` → `selectedCutStyleId?: string`.
- `NewGameSelection.cutStyleIndex: number` → `cutStyleId: string`.
- Inside `createNewGameDialog`, replace `currentCutStyleIndex`/`composableCutIndex`/`fractalCutIndex` with `currentCutStyleId`. Compute via direct id equality, e.g.
  `currentCutStyleId === 'composable'`, `currentCutStyleId === 'fractal'`.
- Rename `buildSizeSection`'s callback `getCutStyleIndex: () => number` → `getCutStyleId: () => string`. Inside `updateLabels`, replace `CUT_STYLE_OPTIONS[args.getCutStyleIndex()].id === 'fractal'` with `args.getCutStyleId() === 'fractal'`. (You'll also need to drop the now-unused import of `CUT_STYLE_OPTIONS` from `buildSizeSection`'s scope if nothing else in the file references it after this change — keep the top-level import line because `createCutStylePicker` is wired below.)
- Use `import { CUT_STYLE_OPTIONS, DEFAULT_CUT_STYLE_ID } from '../game/cut-styles.js';` and pass `options: CUT_STYLE_OPTIONS` to `createCutStylePicker` for now (Task 6 will introduce filtering).

Key block (around `src/ui/new-game-dialog.ts:385-501`) becomes roughly:

```ts
export function createNewGameDialog(options: NewGameDialogOptions): () => void {
    const { container, selectedSizeId, onSelect, onCancel } = options;

    let currentCutStyleId = options.selectedCutStyleId ?? DEFAULT_CUT_STYLE_ID;

    const { overlay, dismiss } = createDismissableOverlay({
        container,
        className: 'size-picker-overlay',
        onDismiss: onCancel,
    });

    const dialog = document.createElement('div');
    dialog.className = 'size-picker-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'New game options');

    const title = document.createElement('h2');
    title.className = 'size-picker-title';
    title.textContent = 'New Game';
    dialog.appendChild(title);

    const sizeSubtitle = document.createElement('h3');
    sizeSubtitle.className = 'size-picker-subtitle';
    sizeSubtitle.textContent = 'Puzzle Size';
    dialog.appendChild(sizeSubtitle);

    const fractalSection = buildFractalOptionsSection({ saved: options.savedFractalConfig });
    const composableSection = buildComposableSlidersSection({ saved: options.savedComposableConfig });
    const imageSourceSection = buildImageSourceSection({
        savedImageSource: options.savedImageSource,
        savedImageCategory: options.savedImageCategory,
        savedVibrant: options.savedVibrant,
    });

    const rotationRow = document.createElement('div');
    rotationRow.className = 'rotation-row';
    const rotationCheckbox = appendCheckboxRow(
        rotationRow,
        'Enable rotation',
        options.savedRotationEnabled ?? false,
    );

    const freeRotationRow = document.createElement('div');
    freeRotationRow.className = 'free-rotation-row';
    const freeRotationCheckbox = appendCheckboxRow(
        freeRotationRow,
        'Free rotation',
        options.savedFreeRotationEnabled ?? false,
    );

    function updateFreeRotationVisibility(): void {
        const visible =
            rotationCheckbox.checked &&
            currentCutStyleId === 'composable';
        freeRotationRow.style.display = visible ? 'block' : 'none';
    }
    rotationCheckbox.addEventListener('change', updateFreeRotationVisibility);
    updateFreeRotationVisibility();

    const sizeSection = buildSizeSection({
        selectedSizeId,
        getCutStyleId: () => currentCutStyleId,
        onPick: (sizeId) => {
            dismiss();
            onSelect({
                sizeId,
                cutStyleId: currentCutStyleId,
                composableConfig: currentCutStyleId === 'composable'
                    ? composableSection.getValues()
                    : undefined,
                fractalConfig: currentCutStyleId === 'fractal'
                    ? fractalSection.getValues()
                    : undefined,
                rotationEnabled: rotationCheckbox.checked,
                freeRotation:
                    rotationCheckbox.checked &&
                    currentCutStyleId === 'composable' &&
                    freeRotationCheckbox.checked,
                ...imageSourceSection.getValues(),
            });
        },
    });

    const cutStyleSection = createCutStylePicker({
        selectedCutStyleId: currentCutStyleId,
        onSelect: (id) => {
            currentCutStyleId = id;
            sizeSection.updateLabels();
            fractalSection.setVisible(id === 'fractal');
            composableSection.setVisible(id === 'composable');
            updateFreeRotationVisibility();
        },
    });

    fractalSection.setVisible(currentCutStyleId === 'fractal');
    composableSection.setVisible(currentCutStyleId === 'composable');

    dialog.appendChild(cutStyleSection);
    dialog.appendChild(rotationRow);
    dialog.appendChild(freeRotationRow);
    dialog.appendChild(fractalSection.element);
    dialog.appendChild(imageSourceSection.element);
    dialog.appendChild(sizeSection.element);
    dialog.appendChild(composableSection.element);

    overlay.appendChild(dialog);

    return dismiss;
}
```

Add the new import at the top:

```ts
import { CUT_STYLE_OPTIONS, DEFAULT_CUT_STYLE_ID } from '../game/cut-styles.js';
```

(Remove the old `findIndex` lines — they're no longer needed.)

- [ ] **Step 6: Update `src/ui/new-game-dialog.test.ts`**

Change every `selectedIndex` → `selectedSizeId`. Add `selectedCutStyleId: 'classic'` to fixtures where needed. Update the `expect(onSelect).toHaveBeenCalledWith({...})` payload to use `sizeId: '192'` and `cutStyleId: 'classic'`. Remove `cutStyleIndex` references entirely.

```bash
npx vitest run src/ui/new-game-dialog.test.ts
```

- [ ] **Step 7: Update `src/main.ts` cut-style call sites**

```bash
grep -n "loadCutStylePreference\|saveCutStylePreference\|getCutStyleOption\|cutStyleIndex\|findCutStyleIndex" src/main.ts
```

For each call site:

- `const preferredCutStyleIndex = loadCutStylePreference();` → `const preferredCutStyleId = loadCutStylePreference();` and pass that as `selectedCutStyleId` to the dialog.
- Inside the dialog `onSelect`, destructure `cutStyleId` instead of `cutStyleIndex`. Save it with `saveCutStylePreference(cutStyleId)`. The CutStyle the rest of the code expects is just the id, no lookup needed: `void startNewGame(..., cutStyleId as CutStyle, ...)`.
- Anywhere `getCutStyleOption(idx).id` appeared, drop the `.id` step — `loadCutStylePreference()` now returns the id directly.

- [ ] **Step 8: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/game/cut-styles.ts src/game/cut-styles.test.ts src/ui/cut-style-picker.ts src/ui/cut-style-picker.test.ts src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/main.ts
git commit -m "refactor(cut-styles): id-keyed storage with legacy-index migration"
```

---

## Task 6: Add `isComposableVisible()` + `getVisibleCutStyleOptions()`

Visibility filter without any taxonomy changes yet (Composable stays in `CUT_STYLE_OPTIONS`; only the new-game dialog filters it out).

**Files:**
- Modify: `src/game/cut-styles.ts`
- Modify: `src/game/cut-styles.test.ts`
- Modify: `src/ui/new-game-dialog.ts`
- Modify: `src/ui/new-game-dialog.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/game/cut-styles.test.ts`:

```ts
import { vi } from 'vitest';
import { getVisibleCutStyleOptions } from './cut-styles.js';

describe('getVisibleCutStyleOptions', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('hides composable on production builds', () => {
        vi.stubEnv('DEV', '');
        vi.stubEnv('BASE_URL', '/puzzle/');
        const ids = getVisibleCutStyleOptions().map((o) => o.id);
        expect(ids).not.toContain('composable');
    });

    it('shows composable on dev-deploys (BASE_URL contains /dev/)', () => {
        vi.stubEnv('DEV', '');
        vi.stubEnv('BASE_URL', '/puzzle/dev/');
        const ids = getVisibleCutStyleOptions().map((o) => o.id);
        expect(ids).toContain('composable');
    });

    it('shows composable when import.meta.env.DEV is truthy', () => {
        vi.stubEnv('DEV', '1');
        vi.stubEnv('BASE_URL', '/');
        const ids = getVisibleCutStyleOptions().map((o) => o.id);
        expect(ids).toContain('composable');
    });
});
```

Make sure `afterEach` is imported at the top:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/cut-styles.test.ts
```

Expected: failing.

- [ ] **Step 3: Implement the visibility helpers**

Append to `src/game/cut-styles.ts`:

```ts
/**
 * Whether the Composable cut style is selectable in the new-game dialog.
 * True on `npm run dev` (`import.meta.env.DEV`) and on the PR-preview
 * deploy (which sets `VITE_BASE_PATH: /puzzle/dev/`). False on the
 * production build.
 *
 * Computed per call rather than cached so tests can stub the env.
 */
export function isComposableVisible(): boolean {
    if (import.meta.env.DEV) return true;
    const base = import.meta.env.BASE_URL ?? '';
    return base.includes('/dev/');
}

/**
 * Return the cut style options the new-game dialog should render —
 * the full list on dev, the list without Composable on production.
 */
export function getVisibleCutStyleOptions(): readonly CutStyleOption[] {
    if (isComposableVisible()) return CUT_STYLE_OPTIONS;
    return CUT_STYLE_OPTIONS.filter((o) => o.id !== 'composable');
}
```

- [ ] **Step 4: Wire the dialog to use the visible list**

In `src/ui/new-game-dialog.ts`, add `getVisibleCutStyleOptions` to the import from `cut-styles.js`. Then in `createNewGameDialog`, pass the filtered list to `createCutStylePicker`:

```ts
import {
    CUT_STYLE_OPTIONS,
    DEFAULT_CUT_STYLE_ID,
    getVisibleCutStyleOptions,
} from '../game/cut-styles.js';
```

```ts
    const visibleOptions = getVisibleCutStyleOptions();
    const cutStyleSection = createCutStylePicker({
        selectedCutStyleId: visibleOptions.some((o) => o.id === currentCutStyleId)
            ? currentCutStyleId
            : DEFAULT_CUT_STYLE_ID,
        options: visibleOptions,
        onSelect: (id) => {
            currentCutStyleId = id;
            sizeSection.updateLabels();
            fractalSection.setVisible(id === 'fractal');
            composableSection.setVisible(id === 'composable');
            updateFreeRotationVisibility();
        },
    });
```

If the saved id isn't in the visible list (e.g., `'composable'` on prod), the picker highlights the default — but `currentCutStyleId` keeps its loaded value so the saved preference isn't rewritten unless the user picks something new. Actually no: change `currentCutStyleId` to also collapse:

```ts
    let currentCutStyleId = options.selectedCutStyleId ?? DEFAULT_CUT_STYLE_ID;
    if (!visibleOptions.some((o) => o.id === currentCutStyleId)) {
        currentCutStyleId = DEFAULT_CUT_STYLE_ID;
    }
```

(Place this just after `visibleOptions` is computed.)

That way the dialog operates only on visible ids, and the only path that can persist `'composable'` from prod is a refresh from the saved value — exactly what we want.

- [ ] **Step 5: Add a dialog test for prod filtering**

Append to `src/ui/new-game-dialog.test.ts`:

```ts
import { vi } from 'vitest';

describe('createNewGameDialog — composable visibility', () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('hides the composable button on production', () => {
        vi.stubEnv('DEV', '');
        vi.stubEnv('BASE_URL', '/puzzle/');
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        expect(
            container.querySelector('[data-cut-style-id="composable"]'),
        ).toBeNull();
    });

    it('shows the composable button on dev-deploys', () => {
        vi.stubEnv('DEV', '');
        vi.stubEnv('BASE_URL', '/puzzle/dev/');
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        expect(
            container.querySelector('[data-cut-style-id="composable"]'),
        ).not.toBeNull();
    });
});
```

Make sure `afterEach` is in the top-of-file imports.

- [ ] **Step 6: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/game/cut-styles.ts src/game/cut-styles.test.ts src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts
git commit -m "feat(cut-styles): hide composable from prod new-game dialog"
```

---

## Task 7: Add the Wavy cut style entry

Adds the `'wavy'` id to the `CutStyle` union and `CUT_STYLE_OPTIONS`, ordered between Fractal and Composable. The strategy and dialog wiring come later — this task just gets the taxonomy in place.

**Files:**
- Modify: `src/game/cut-styles.ts`
- Modify: `src/game/cut-styles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/game/cut-styles.test.ts` inside the `describe('CUT_STYLE_OPTIONS', …)` block:

```ts
    it('includes wavy between fractal and composable', () => {
        const ids = CUT_STYLE_OPTIONS.map((o) => o.id);
        const fractalIdx = ids.indexOf('fractal');
        const wavyIdx = ids.indexOf('wavy');
        const composableIdx = ids.indexOf('composable');
        expect(wavyIdx).toBeGreaterThan(fractalIdx);
        expect(composableIdx).toBeGreaterThan(wavyIdx);
    });

    it('renders wavy in the visible list on production', () => {
        vi.stubEnv('DEV', '');
        vi.stubEnv('BASE_URL', '/puzzle/');
        const ids = getVisibleCutStyleOptions().map((o) => o.id);
        expect(ids).toContain('wavy');
        vi.unstubAllEnvs();
    });
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/cut-styles.test.ts
```

Expected: failing — no `'wavy'` in CUT_STYLE_OPTIONS.

- [ ] **Step 3: Add Wavy**

In `src/game/cut-styles.ts`, update the `CutStyle` type and `CUT_STYLE_OPTIONS`:

```ts
/**
 * Identifier for a cut style generator.
 */
export type CutStyle = 'classic' | 'fractal' | 'wavy' | 'composable';
```

```ts
export const CUT_STYLE_OPTIONS: readonly CutStyleOption[] = [
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional jigsaw tabs',
    },
    {
        id: 'fractal',
        label: 'Fractal',
        description: 'Organic circle-packing',
    },
    {
        id: 'wavy',
        label: 'Wavy',
        description: 'Like Classic, but each cut curves boldly',
    },
    {
        id: 'composable',
        label: 'Composable',
        description: 'Experimental — customizable cuts',
    },
] as const;
```

`LEGACY_ORDER` stays as `['classic', 'fractal', 'composable']` — the pre-migration order is unchanged.

- [ ] **Step 4: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/game/cut-styles.ts src/game/cut-styles.test.ts
git commit -m "feat(cut-styles): add Wavy option between Fractal and Composable"
```

---

## Task 8: Add the Wavy generation strategy

**Files:**
- Modify: `src/game/cut-style-strategies.ts`
- Create: `src/game/cut-style-strategies.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/game/cut-style-strategies.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { createNewGame } from './init.js';

describe('wavy strategy', () => {
    it('is registered for cutStyle "wavy"', () => {
        const strategy = getCutStyleStrategy('wavy');
        expect(strategy).toBeDefined();
        expect(typeof strategy.generatePieces).toBe('function');
    });

    it('uses the image dimensions as-is (no inscription)', () => {
        const strategy = getCutStyleStrategy('wavy');
        const out = strategy.inscribePuzzleSize(
            { width: 1080, height: 720 },
            { cols: 8, rows: 6 },
            {},
        );
        expect(out).toEqual({ width: 1080, height: 720 });
    });

    it('does not scale the user-facing grid', () => {
        const strategy = getCutStyleStrategy('wavy');
        expect(strategy.scaleGrid({ cols: 6, rows: 4 }, { width: 100, height: 100 }, {})).toEqual({
            cols: 6, rows: 4,
        });
    });

    it('generates pieces for the requested grid', () => {
        const strategy = getCutStyleStrategy('wavy');
        const { pieces } = strategy.generatePieces(
            { cols: 6, rows: 4 },
            { width: 1080, height: 720 },
            12345,
            {},
        );
        // 24 base pieces; auto-grouping at minPieceArea = avg/4 is unlikely
        // to consume any of them at this size, but allow ≤24.
        expect(pieces.length).toBeGreaterThanOrEqual(20);
        expect(pieces.length).toBeLessThanOrEqual(24);
    });

    it('produces identical pieces for the same seed', () => {
        const s = getCutStyleStrategy('wavy');
        const a = s.generatePieces({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, 12345, {});
        const b = s.generatePieces({ cols: 6, rows: 4 }, { width: 1080, height: 720 }, 12345, {});
        expect(b.pieces.length).toBe(a.pieces.length);
        // Spot-check geometry equivalence via the shape strings.
        for (let i = 0; i < a.pieces.length; i++) {
            expect(b.pieces[i].shape).toBe(a.pieces[i].shape);
        }
    });
});

describe('createNewGame with cutStyle "wavy"', () => {
    it('leaves composableConfig undefined on the GameState', () => {
        const state = createNewGame(
            'blank',
            { width: 1080, height: 720 },
            { width: 800, height: 600 },
            { cols: 8, rows: 6 },
            { cutStyle: 'wavy', seed: 1 },
        );
        expect(state.cutStyle).toBe('wavy');
        expect(state.composableConfig).toBeUndefined();
        expect(state.fractalConfig).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/game/cut-style-strategies.test.ts
```

Expected: failing — no strategy registered for `'wavy'`, `getCutStyleStrategy('wavy')` returns undefined.

- [ ] **Step 3: Add the strategy**

In `src/game/cut-style-strategies.ts`, insert above the `STRATEGIES` constant:

```ts
const wavyStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed) => {
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
        });
    },
    // configKey omitted — Wavy is fully reproducible from seed + gridSize.
};
```

Update the `STRATEGIES` map:

```ts
const STRATEGIES: Record<CutStyle, CutStyleStrategy> = {
    classic: classicStrategy,
    composable: composableStrategy,
    fractal: fractalStrategy,
    wavy: wavyStrategy,
};
```

- [ ] **Step 4: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/game/cut-style-strategies.ts src/game/cut-style-strategies.test.ts
git commit -m "feat(cut-style-strategies): add wavy strategy with grid-derived params"
```

---

## Task 9: Widen free-rotation visibility to Wavy

The "Free rotation" sub-checkbox in the new-game dialog currently appears only when cut style = composable. Widen it to include Wavy. Also widen `main.ts`'s `rotationMode` derivation.

**Files:**
- Modify: `src/ui/new-game-dialog.ts`
- Modify: `src/ui/new-game-dialog.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/ui/new-game-dialog.test.ts`:

```ts
describe('createNewGameDialog — free rotation sub-checkbox', () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        vi.stubEnv('DEV', '1'); // composable visible
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function getFreeRotationRow(): HTMLElement {
        return container.querySelector('.free-rotation-row') as HTMLElement;
    }

    it('is hidden by default (rotation off)', () => {
        createNewGameDialog({
            container, selectedSizeId: '48', selectedCutStyleId: 'wavy',
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
    });

    it('is visible when rotation is on and cut style is wavy', () => {
        createNewGameDialog({
            container, selectedSizeId: '48', selectedCutStyleId: 'wavy',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('block');
    });

    it('is visible when rotation is on and cut style is composable', () => {
        createNewGameDialog({
            container, selectedSizeId: '48', selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('block');
    });

    it('is hidden when rotation is on but cut style is classic', () => {
        createNewGameDialog({
            container, selectedSizeId: '48', selectedCutStyleId: 'classic',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
    });

    it('is hidden when rotation is on but cut style is fractal', () => {
        createNewGameDialog({
            container, selectedSizeId: '48', selectedCutStyleId: 'fractal',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/new-game-dialog.test.ts
```

Expected: the "visible when wavy" case fails — wavy currently doesn't trigger the sub-checkbox.

- [ ] **Step 3: Widen the dialog predicate**

In `src/ui/new-game-dialog.ts`, update `updateFreeRotationVisibility`:

```ts
    function updateFreeRotationVisibility(): void {
        const visible =
            rotationCheckbox.checked &&
            (currentCutStyleId === 'wavy' || currentCutStyleId === 'composable');
        freeRotationRow.style.display = visible ? 'block' : 'none';
    }
```

Also update the `freeRotation:` assignment in the size-section onPick to mirror that:

```ts
                freeRotation:
                    rotationCheckbox.checked &&
                    (currentCutStyleId === 'wavy' || currentCutStyleId === 'composable') &&
                    freeRotationCheckbox.checked,
```

- [ ] **Step 4: Widen `main.ts`'s rotation derivation**

In `src/main.ts`, find the rotation mode block (around line 724):

```ts
        let rotationMode: 'none' | 'quarter-turn' | 'free';
        if (!rotationEnabled) {
            rotationMode = 'none';
        } else if (freeRotation && cutStyle === 'composable') {
            rotationMode = 'free';
        } else {
            rotationMode = 'quarter-turn';
        }
```

Replace with:

```ts
        let rotationMode: 'none' | 'quarter-turn' | 'free';
        if (!rotationEnabled) {
            rotationMode = 'none';
        } else if (freeRotation && (cutStyle === 'wavy' || cutStyle === 'composable')) {
            rotationMode = 'free';
        } else {
            rotationMode = 'quarter-turn';
        }
```

- [ ] **Step 5: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/new-game-dialog.ts src/ui/new-game-dialog.test.ts src/main.ts
git commit -m "feat(rotation): allow free rotation for wavy puzzles"
```

---

## Task 10: Add `'wavy'` to the share-link `c` field

**Files:**
- Modify: `src/sharing/share-link.ts`
- Modify: `src/sharing/share-link.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/sharing/share-link.test.ts`:

```ts
describe('share-link codec — wavy', () => {
    it('round-trips a wavy payload with no cf', () => {
        const payload: SharePayload = {
            v: 1,
            i: 'x',
            is: [1080, 720],
            g: [6, 4],
            c: 'wavy',
            s: 42,
            r: 'none',
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('round-trips a wavy payload with free rotation', () => {
        const payload: SharePayload = {
            v: 1, i: 'x', is: [1080, 720], g: [8, 6],
            c: 'wavy', s: 7, r: 'free',
        };
        expect(decodePayload(encodePayload(payload))).toEqual(payload);
    });

    it('rejects a wavy payload with a cf block (wavy should not carry cf)', () => {
        // Wavy's config is derived from gridSize; cf is composable-only.
        // Older or maliciously-crafted payloads with cf on a wavy puzzle
        // are still accepted by isValidPayload (it doesn't enforce
        // cf-absence on wavy), but gameStateToPayload never emits one.
        const state: GameState = makeGameState({
            seed: 7,
            cutStyle: 'wavy',
            rotationMode: 'none',
            gridSize: { cols: 6, rows: 4 },
        });
        const payload = gameStateToPayload(state, { includeProgress: false });
        expect(payload.cf).toBeUndefined();
        expect(payload.c).toBe('wavy');
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/sharing/share-link.test.ts
```

Expected: failing — `'wavy'` rejected by the `c` union check.

- [ ] **Step 3: Add `'wavy'` to the schema**

In `src/sharing/share-link.ts`, update the `SharePayload` interface:

```ts
    /** Cut style. */
    c: 'classic' | 'fractal' | 'composable' | 'wavy';
```

And the `isValidPayload` check:

```ts
    if (p.c !== 'classic' && p.c !== 'fractal'
        && p.c !== 'composable' && p.c !== 'wavy') return false;
```

`gameStateToPayload` already emits the `cf` block only when
`cutStyle === 'composable'`, so wavy gets no `cf` by default — no
change needed there.

- [ ] **Step 4: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sharing/share-link.ts src/sharing/share-link.test.ts
git commit -m "feat(share-link): accept 'wavy' as a cut style in payloads"
```

---

## Task 11: Add `window.__newComposableGame` console helper

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the helper**

In `src/main.ts`, add a new helper alongside the existing `__startVennPuzzle` (around line 440):

```ts
/**
 * Dev-console hook for launching a Composable puzzle with arbitrary
 * generator parameters. Exposed because Composable is hidden from the
 * production new-game dialog; power users can still reach the full
 * surface via this helper.
 *
 * Usage:
 *   __newComposableGame()
 *   __newComposableGame({ cols: 12, rows: 8 })
 *   __newComposableGame({
 *       baseCutConfig: { cols: 8, rows: 6, ha: 0.3, hf: 2, va: 0.3, vf: 1.5 },
 *       tabGenerator: 'none',
 *   })
 *   __newComposableGame({ rotation: 'free' })
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__newComposableGame = (overrides?: {
    cols?: number;
    rows?: number;
    baseCutGenerator?: string;
    baseCutConfig?: Record<string, unknown>;
    tabGenerator?: string;
    tabConfig?: Record<string, unknown>;
    minPieceArea?: number;
    rotation?: 'none' | 'quarter-turn' | 'free';
    imageSource?: 'random' | 'blank';
}) => {
    const cols = overrides?.cols ?? 8;
    const rows = overrides?.rows ?? 6;
    const baseCutConfig = overrides?.baseCutConfig ?? {
        cols, rows, ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5,
    };
    const config: import('./puzzle/composable-generator.js').ComposableConfig = {
        baseCutGenerator: overrides?.baseCutGenerator ?? 'sine',
        baseCutConfig,
        tabGenerator: overrides?.tabGenerator ?? 'classic',
        tabConfig: overrides?.tabConfig ?? {},
    };
    if (overrides?.minPieceArea !== undefined) {
        config.minPieceArea = overrides.minPieceArea;
    }
    const rotation = overrides?.rotation ?? 'none';
    void startNewGame(
        { cols, rows },
        'composable',
        config,
        overrides?.imageSource ?? loadImageSourcePreference(),
        loadImageCategoryPreference(),
        undefined,
        loadVibrantPreference(),
        rotation !== 'none',
        rotation === 'free',
    );
};
```

Make sure the imports for `loadImageSourcePreference`, `loadImageCategoryPreference`, `loadVibrantPreference` already exist higher up in the file — they do (current main.ts imports them).

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass. The helper is a `window` side effect; we don't add a test for it (it depends on the full app boot).

- [ ] **Step 3: Smoke-test in the browser (optional but encouraged)**

```bash
npm run dev
```

In the browser console:
```js
__newComposableGame()
__newComposableGame({ rotation: 'free', tabGenerator: 'none' })
```

Both should start a Composable game.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): expose __newComposableGame helper for dev console"
```

---

## Task 12: Update info-modal help text

Replace the Composable bullet with a Wavy bullet, and move the Free rotation sub-bullet under Wavy.

**Files:**
- Modify: `src/ui/info-modal.ts`
- Modify: `src/ui/info-modal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/info-modal.test.ts`:

```ts
describe('createInfoModal — Cut Styles section', () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    function cutStylesSection(): HTMLElement {
        // The Cut Styles section is the second <section.info-section>
        // (How to Play is first). Look it up by heading text instead
        // for robustness.
        const headings = container.querySelectorAll<HTMLHeadingElement>(
            '.info-section > h3',
        );
        const match = [...headings].find((h) => h.textContent === 'Cut Styles');
        return match!.parentElement!;
    }

    it('mentions Wavy as a cut style', () => {
        createInfoModal({ container });
        expect(cutStylesSection().textContent).toContain('Wavy');
    });

    it('does not mention Composable in the help text', () => {
        createInfoModal({ container });
        expect(cutStylesSection().textContent).not.toContain('Composable');
    });

    it('mentions Free rotation in the Wavy bullet', () => {
        createInfoModal({ container });
        const html = cutStylesSection().innerHTML;
        const wavyIdx = html.indexOf('Wavy');
        const freeRotIdx = html.indexOf('Free rotation');
        expect(wavyIdx).toBeGreaterThan(-1);
        expect(freeRotIdx).toBeGreaterThan(wavyIdx);
    });
});
```

- [ ] **Step 2: Run, verify failing**

```bash
npx vitest run src/ui/info-modal.test.ts
```

Expected: failing.

- [ ] **Step 3: Update the help text**

In `src/ui/info-modal.ts`, find `buildCutStylesSection` (around line 155). Replace the composable block with a wavy block:

```ts
    const wavyLi = document.createElement('li');
    appendInline(wavyLi, [
        ['strong', 'Wavy'],
        ' — Smooth sinewave edges with classic jigsaw tabs — a more dramatic take on Classic. Options:',
    ]);
    const wavySub = document.createElement('ul');
    appendInlineLi(wavySub, [
        ['strong', 'Free rotation'],
        ' (when rotation is also enabled) — Pieces rotate continuously to any angle instead of snapping to the four 90° orientations. Use the round drag handle below the focused piece.',
    ]);
    wavyLi.appendChild(wavySub);
    list.appendChild(wavyLi);
```

Remove the old `composableLi` block entirely.

- [ ] **Step 4: Run all tests, verify passing**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/info-modal.ts src/ui/info-modal.test.ts
git commit -m "docs(info-modal): describe Wavy cut style and move Free rotation bullet"
```

---

## Task 13: Manual integration check

A short hand-played smoke pass against the browser. Not strictly a TDD step, but the safety net for everything the unit tests don't cover.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: New game → Wavy → 6×4**

In the new-game dialog:
- Cut Style: pick Wavy.
- Size: 24 pieces.
- Image: Blank (white) for clarity.
- Click "Enable rotation" → confirm the Free rotation sub-checkbox appears.
- Leave Free rotation off, click 24 pieces.

Expected: a 6×4 puzzle with smooth wavy edges, tabs visible, ~3 full waves across the width and ~2 across the height.

- [ ] **Step 3: Copy a share-link, paste into a new tab**

In the info modal, copy the share-link, paste into a new browser tab. Expected: same wavy puzzle is reproduced.

- [ ] **Step 4: Verify Composable is not in the picker on prod-mode build**

```bash
npm run build && npx vite preview
```

Open the previewed app, click New Game. Expected: Composable is **not** in the cut-style picker. Wavy is.

- [ ] **Step 5: Verify `__newComposableGame()` works in the console**

In the preview, open the JS console:

```js
__newComposableGame({ rotation: 'free' })
```

Expected: a Composable puzzle starts with free rotation enabled.

- [ ] **Step 6: Verify legacy preference migration**

Before reloading, set localStorage manually:

```js
localStorage.setItem('puzzle-cut-style', '2')
location.reload()
```

Expected: dialog opens with Classic highlighted (because saved `'composable'` is hidden on prod), and `localStorage.getItem('puzzle-cut-style')` still reads `'2'` until the user picks a new style.

If any step fails, fix and re-run before moving on.

- [ ] **Step 7: No commit needed** — this is a verification task only.

---

## Final Self-Review Checklist

Run these before opening the PR:

- [ ] `npm test` — all tests pass.
- [ ] `npm run lint` (if the repo has it) — no new warnings.
- [ ] `npm run build` — type-checks and bundles cleanly.
- [ ] Inspect the `__newComposableGame` helper in a dev build to confirm the no-arg form starts a working puzzle.
- [ ] Spec coverage: each section of `docs/superpowers/specs/2026-05-19-wavy-cut-style-design.md` corresponds to a task above (Tasks 1–5 = preference migration, Task 6 = visibility, Tasks 7–9 = Wavy taxonomy/generation/rotation, Task 10 = share-link, Task 11 = console helper, Task 12 = help text).
- [ ] Open a PR. The branch already has the spec commit; this stack of feature commits goes on top. Include `Closes #<issue>` if there's a tracking issue.
