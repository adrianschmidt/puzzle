# Extended-Palette Background Colour Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 12 hardcoded background presets with the full lime-elements extended palette (100 colours: 20 hues × 5 tones), with OS dark-mode dimming, referenced by name, and factor the picker UI into a reusable swatch-grid component (for #392).

**Architecture:** A new `palette.ts` holds the palette as plain JS data (light + dark hex per swatch) — the single source of truth, so the existing `isLightColour(hex)` luminance logic keeps working with no `getComputedStyle`. `background-colour.ts` derives its presets from the palette and persists the chosen id as a validated string (no legacy migration). A new generic `swatch-picker.ts` builds the button + popover + grid; `background-colour-picker.ts` becomes a thin adapter over it. A `prefers-color-scheme` listener in `main.ts` re-applies the background when the OS theme flips.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), plain DOM, CSS grid.

**Spec:** `docs/superpowers/specs/2026-06-03-extended-palette-picker-design.md`

**Commands:**
- Single test file: `npx vitest run src/ui/<file>.test.ts`
- All tests: `npm test`
- Typecheck: `npx tsc --noEmit`

---

## File Structure

- **Create** `src/ui/palette.ts` — palette data (100 swatches, light+dark hex) + OS-scheme helpers (`prefersDarkScheme`, `activeHex`, `onColorSchemeChange`).
- **Create** `src/ui/palette.test.ts` — palette data/shape + helper tests.
- **Create** `src/ui/swatch-picker.ts` — reusable button + popover + swatch grid.
- **Create** `src/ui/swatch-picker.test.ts` — generic picker tests.
- **Rewrite** `src/ui/background-colour.ts` — presets from palette; string-validated persistence; OS-aware apply.
- **Rewrite** `src/ui/background-colour.test.ts` — *(create if absent)* persistence/apply tests.
- **Rewrite** `src/ui/background-colour-picker.ts` — thin adapter over `createSwatchPicker`.
- **Rewrite** `src/ui/background-colour-picker.test.ts` — adapter tests.
- **Modify** `src/ui/index.ts` — export `createSwatchPicker`; keep existing background exports.
- **Modify** `src/main.ts` — register OS-scheme listener to re-apply the background.
- **Modify** `src/style.css` — reusable `.swatch-grid` / `.swatch` rules; widen + viewport-clamp the panel.

> Note: `BackgroundColourPreset` keeps its current shape (`{ id, label, colour }`) so `src/ui/index.ts`'s `export type { BackgroundColourPreset }` and any consumer stay valid. `colour` is the OS-resolved hex at the moment of use.

---

## Task 1: Palette data module

**Files:**
- Create: `src/ui/palette.ts`
- Test: `src/ui/palette.test.ts`

- [ ] **Step 1: Write the failing test**

`src/ui/palette.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    PALETTE_HUES,
    PALETTE_TONES,
    PALETTE_SWATCHES,
    prefersDarkScheme,
    activeHex,
    onColorSchemeChange,
} from './palette.js';

describe('PALETTE_SWATCHES', () => {
    it('contains one entry per hue × tone (100)', () => {
        expect(PALETTE_HUES.length).toBe(20);
        expect(PALETTE_TONES.length).toBe(5);
        expect(PALETTE_SWATCHES.length).toBe(100);
    });

    it('uses "<hue>-<tone>" ids and "<hue> <tone>" labels', () => {
        const blue = PALETTE_SWATCHES.find((s) => s.id === 'blue-default');
        expect(blue).toBeDefined();
        expect(blue?.label).toBe('blue default');
    });

    it('gives every swatch a light and dark hex', () => {
        for (const s of PALETTE_SWATCHES) {
            expect(s.light).toMatch(/^#[0-9a-f]{6}$/i);
            expect(s.dark).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('has unique ids', () => {
        const ids = new Set(PALETTE_SWATCHES.map((s) => s.id));
        expect(ids.size).toBe(PALETTE_SWATCHES.length);
    });

    it('is ordered tone-major (rows = tones, columns = hues)', () => {
        // First 20 entries are all the "lighter" tone, one per hue.
        const firstRow = PALETTE_SWATCHES.slice(0, 20);
        expect(firstRow.every((s) => s.id.endsWith('-lighter'))).toBe(true);
        expect(firstRow[0].id).toBe(`${PALETTE_HUES[0]}-lighter`);
    });
});

describe('activeHex', () => {
    const swatch = { id: 'blue-default', label: 'blue default', light: '#2196f3', dark: '#1e88e5' };

    afterEach(() => vi.unstubAllGlobals());

    function stubMatchMedia(matches: boolean): void {
        vi.stubGlobal('matchMedia', () => ({
            matches,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
    }

    it('returns the light hex when the OS is in light mode', () => {
        stubMatchMedia(false);
        expect(prefersDarkScheme()).toBe(false);
        expect(activeHex(swatch)).toBe('#2196f3');
    });

    it('returns the dark hex when the OS is in dark mode', () => {
        stubMatchMedia(true);
        expect(prefersDarkScheme()).toBe(true);
        expect(activeHex(swatch)).toBe('#1e88e5');
    });

    it('falls back to light when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);
        expect(prefersDarkScheme()).toBe(false);
        expect(activeHex(swatch)).toBe('#2196f3');
    });
});

describe('onColorSchemeChange', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('subscribes/unsubscribes to the media query', () => {
        const add = vi.fn();
        const remove = vi.fn();
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: add,
            removeEventListener: remove,
        }));
        const cb = vi.fn();
        const off = onColorSchemeChange(cb);
        expect(add).toHaveBeenCalledOnce();
        off();
        expect(remove).toHaveBeenCalledOnce();
    });

    it('is a no-op when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);
        const off = onColorSchemeChange(vi.fn());
        expect(() => off()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/palette.test.ts`
Expected: FAIL — `Cannot find module './palette.js'`.

- [ ] **Step 3: Write the implementation**

`src/ui/palette.ts`. Hex values are transcribed from lime-elements
`src/style/color-palette-extended.css` — `light` from the `:root` block,
`dark` from the `@media (prefers-color-scheme: dark)` block. Hues only
(brand, deprecated brand, white/black, and the contrast greyscale are
excluded). Tone order per hue: `[lighter, light, default, dark, darker]`.

```ts
/**
 * Extended colour palette ported from lime-elements'
 * `color-palette-extended.css` (hues only — brand colours, absolute
 * white/black, and the contrast greyscale are excluded). Each swatch
 * carries a light- and dark-mode hex so the puzzle's luminance-based
 * UI-chrome logic keeps working without resolving CSS variables.
 */

export const PALETTE_HUES = [
    'red', 'pink', 'magenta', 'purple', 'violet', 'indigo', 'blue', 'sky',
    'cyan', 'teal', 'green', 'lime', 'grass', 'yellow', 'amber', 'orange',
    'coral', 'brown', 'gray', 'glaucous',
] as const;

export const PALETTE_TONES = [
    'lighter', 'light', 'default', 'dark', 'darker',
] as const;

export type PaletteHue = (typeof PALETTE_HUES)[number];
export type PaletteTone = (typeof PALETTE_TONES)[number];

export interface PaletteSwatch {
    /** Stable id, "<hue>-<tone>", e.g. "blue-default". */
    id: string;
    /** Human label, "<hue> <tone>", e.g. "blue default". */
    label: string;
    /** Hex used when the OS is in light mode. */
    light: string;
    /** Hex used when the OS is in dark mode (slightly dimmer). */
    dark: string;
}

/** Tone tuples: [lighter, light, default, dark, darker]. */
type ToneTuple = readonly [string, string, string, string, string];

const LIGHT: Record<PaletteHue, ToneTuple> = {
    red:      ['#ffcdd2', '#ff756b', '#f44336', '#d32f2f', '#b71c1c'],
    pink:     ['#f8bbd0', '#f06292', '#e91e63', '#c2185b', '#880e4f'],
    magenta:  ['#f9b0d4', '#f759a6', '#f34197', '#c72e79', '#9c1657'],
    purple:   ['#e1bee7', '#ba68c8', '#9c27b0', '#7b1fa2', '#4a148c'],
    violet:   ['#d1c4e9', '#9575cd', '#673ab7', '#512da8', '#311b92'],
    indigo:   ['#c5cae9', '#7986cb', '#3f51b5', '#303f9f', '#1a237e'],
    blue:     ['#bbdefb', '#64b5f6', '#2196f3', '#1976d2', '#0d47a1'],
    sky:      ['#b3e5fc', '#4fc3f7', '#03a9f4', '#0288d1', '#01579b'],
    cyan:     ['#b2ebf2', '#4dd0e1', '#00bcd4', '#0097a7', '#006064'],
    teal:     ['#b2dfdb', '#4db6ac', '#009688', '#00796b', '#004d40'],
    green:    ['#c8e6c9', '#81c784', '#4caf50', '#388e3c', '#1b5e20'],
    lime:     ['#dcedc8', '#aed581', '#8bc34a', '#689f38', '#33691e'],
    grass:    ['#f0f4c3', '#dce775', '#cddc39', '#afb42b', '#827717'],
    yellow:   ['#fff9c4', '#fff176', '#ffeb3b', '#fbce2c', '#e8bf29'],
    amber:    ['#ffecb3', '#ffd54f', '#ffc107', '#ffa000', '#ff6f00'],
    orange:   ['#ffe0b2', '#ffb74d', '#ff9800', '#f57c00', '#e65100'],
    coral:    ['#ffccbc', '#ff8a65', '#ff5722', '#e64a19', '#bf360c'],
    brown:    ['#d7ccc8', '#a1887f', '#795548', '#5d4037', '#3e2723'],
    gray:     ['#f5f5f5', '#e0e0e0', '#9e9e9e', '#575756', '#212121'],
    glaucous: ['#d0e1e8', '#87aec1', '#57879f', '#3a6477', '#254758'],
};

const DARK: Record<PaletteHue, ToneTuple> = {
    red:      ['#ef9a9a', '#f05750', '#e53935', '#c62828', '#a51717'],
    pink:     ['#f48fb1', '#ec407a', '#d81b60', '#ad1457', '#840a4b'],
    magenta:  ['#f9a1cc', '#f94fa2', '#ff3195', '#d01f75', '#9c1657'],
    purple:   ['#ce93d8', '#ab47bc', '#8e24aa', '#6a1b9a', '#3e0d79'],
    violet:   ['#b39ddb', '#7e57c2', '#5e35b1', '#4527a0', '#29167f'],
    indigo:   ['#9fa8da', '#5c6bc0', '#3949ab', '#283593', '#151e73'],
    blue:     ['#90caf9', '#42a5f5', '#1e88e5', '#1565c0', '#0a3c8a'],
    sky:      ['#81d4fa', '#29b6f6', '#039be5', '#0277bd', '#015190'],
    cyan:     ['#80deea', '#26c6da', '#00acc1', '#00838f', '#00595d'],
    teal:     ['#80cbc4', '#26a69a', '#00897b', '#00695c', '#015245'],
    green:    ['#a5d6a7', '#66bb6a', '#43a047', '#2e7d32', '#206125'],
    lime:     ['#c5e1a5', '#9ccc65', '#7cb342', '#558b2f', '#2b5a19'],
    grass:    ['#e6ee9c', '#d4e157', '#c0ca33', '#9e9d24', '#776d13'],
    yellow:   ['#fff59d', '#ffee58', '#fdd835', '#f5c827', '#e0b415'],
    amber:    ['#ffe082', '#ffcf3d', '#ffb03b', '#ff8f00', '#de6202'],
    orange:   ['#ffcc80', '#ffa726', '#fb8c00', '#ef6c00', '#d84d01'],
    coral:    ['#ffab91', '#ff7043', '#f4511e', '#d84315', '#b5320a'],
    brown:    ['#bcaaa4', '#8d6e63', '#6d4c41', '#4e342e', '#33201c'],
    gray:     ['#eeeeee', '#adadad', '#757575', '#424242', '#212020'],
    glaucous: ['#9fc2d0', '#6e8d9c', '#446c80', '#2a576b', '#224150'],
};

/**
 * All swatches in tone-major order: the "lighter" tone of every hue
 * first, then "light", etc. With a 20-column grid this lays out as rows
 * = tones, columns = hues (mirrors the limel-color-picker layout).
 */
export const PALETTE_SWATCHES: readonly PaletteSwatch[] = PALETTE_TONES.flatMap(
    (tone, toneIndex) =>
        PALETTE_HUES.map((hue) => ({
            id: `${hue}-${tone}`,
            label: `${hue} ${tone}`,
            light: LIGHT[hue][toneIndex],
            dark: DARK[hue][toneIndex],
        })),
);

/** True when the OS reports a dark colour-scheme preference. */
export function prefersDarkScheme(): boolean {
    return (
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-color-scheme: dark)').matches
    );
}

/** The hex to use for a swatch under the current OS colour-scheme. */
export function activeHex(swatch: PaletteSwatch): string {
    return prefersDarkScheme() ? swatch.dark : swatch.light;
}

/**
 * Subscribe to OS colour-scheme changes. Returns an unsubscribe
 * function. No-op (and a no-op unsubscribe) when `matchMedia` is
 * unavailable (e.g. jsdom).
 */
export function onColorSchemeChange(callback: () => void): () => void {
    if (typeof matchMedia !== 'function') {
        return () => {};
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/palette.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/palette.ts src/ui/palette.test.ts
git commit -m "feat(palette): add extended hue palette data and OS-scheme helpers (#391)"
```

---

## Task 2: Background-colour presets & persistence

**Files:**
- Rewrite: `src/ui/background-colour.ts`
- Test: `src/ui/background-colour.test.ts` (create)

This drops the 12 presets, the `LEGACY_ORDER` migration, and the
`createIdPreferenceStore` usage. Persistence becomes a validated string
preference: a saved value that isn't a current palette id (including old
numeric indices like `"3"` and old ids like `"midnight"`) falls back to
the default.

- [ ] **Step 1: Write the failing test**

`src/ui/background-colour.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_ID,
    getColourPreset,
    loadColourPreference,
    saveColourPreference,
    applyBackgroundColour,
    isLightColour,
    COLOUR_PREFERENCE_KEY,
} from './background-colour.js';

describe('BACKGROUND_COLOUR_PRESETS', () => {
    it('exposes the full palette (100 presets)', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBe(100);
    });

    it('default id resolves to a preset', () => {
        expect(BACKGROUND_COLOUR_PRESETS.some((p) => p.id === DEFAULT_COLOUR_ID)).toBe(true);
    });
});

describe('getColourPreset', () => {
    it('returns the matching preset', () => {
        const preset = getColourPreset('blue-default');
        expect(preset.id).toBe('blue-default');
        expect(preset.colour).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('falls back to the default for an unknown id', () => {
        expect(getColourPreset('nope').id).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('loadColourPreference', () => {
    beforeEach(() => localStorage.clear());

    it('returns the default when nothing is saved', () => {
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('round-trips a valid id', () => {
        saveColourPreference('green-dark');
        expect(loadColourPreference()).toBe('green-dark');
    });

    it('falls back to default for a legacy numeric index', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '3');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('falls back to default for an old string id', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'midnight');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('isLightColour', () => {
    it('classifies light and dark hexes', () => {
        expect(isLightColour('#ffffff')).toBe(true);
        expect(isLightColour('#000000')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sets the custom property and ui-scheme', () => {
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
        applyBackgroundColour('gray-lighter'); // #f5f5f5 -> light
        expect(
            document.documentElement.style.getPropertyValue('--puzzle-bg-colour'),
        ).toBe('#f5f5f5');
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/background-colour.test.ts`
Expected: FAIL — the module still exports the 12 presets / `getColourPreset` from the id store, so the count assertion (and `isLightColour` export usage if signature differs) fails.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/ui/background-colour.ts`:

```ts
/**
 * Background colour presets and persistence.
 *
 * Presets are the full extended palette (see `palette.ts`). The chosen
 * preset is saved by its stable string id. There is no migration from
 * the old index-based or named presets — an unrecognised saved value
 * falls back to the default.
 */

import { createStringPreference } from './preference-store.js';
import {
    PALETTE_SWATCHES,
    activeHex,
    type PaletteSwatch,
} from './palette.js';

export interface BackgroundColourPreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label, e.g. "blue default". */
    label: string;
    /** CSS colour value resolved for the current OS colour-scheme. */
    colour: string;
}

/** Default preset id — a fixed dark hue (closest to the old "midnight"). */
export const DEFAULT_COLOUR_ID = 'indigo-darker';

/** localStorage key for the saved background colour. */
export const COLOUR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-colour';

const swatchById = new Map<string, PaletteSwatch>(
    PALETTE_SWATCHES.map((s) => [s.id, s]),
);

function toPreset(swatch: PaletteSwatch): BackgroundColourPreset {
    return { id: swatch.id, label: swatch.label, colour: activeHex(swatch) };
}

/**
 * Available background colour presets (the full palette). `colour` is
 * the OS-resolved hex at the time of access.
 */
export const BACKGROUND_COLOUR_PRESETS: readonly BackgroundColourPreset[] =
    PALETTE_SWATCHES.map(toPreset);

const ALLOWED_IDS = PALETTE_SWATCHES.map((s) => s.id);

const store = createStringPreference({
    key: COLOUR_PREFERENCE_KEY,
    allowed: ALLOWED_IDS,
    defaultValue: DEFAULT_COLOUR_ID,
});

export const saveColourPreference = store.save;
export const loadColourPreference = store.load;

/** Get the preset for an id, resolved for the current OS scheme. */
export function getColourPreset(id: string): BackgroundColourPreset {
    const swatch = swatchById.get(id) ?? swatchById.get(DEFAULT_COLOUR_ID)!;
    return toPreset(swatch);
}

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
 * Apply a background colour to the document root, resolving the hex for
 * the current OS colour-scheme and updating the UI-chrome scheme from
 * its luminance.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/background-colour.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `background-colour-picker.ts` / its test (they still reference the removed `createSwatch`/`createPickerPanel` and the old preset shape). Those are fixed in Tasks 3–4. If any *other* file errors, stop and reconcile.

- [ ] **Step 6: Commit**

```bash
git add src/ui/background-colour.ts src/ui/background-colour.test.ts
git commit -m "feat(palette): derive background presets from the extended palette (#391)"
```

---

## Task 3: Reusable swatch-grid picker

**Files:**
- Create: `src/ui/swatch-picker.ts`
- Test: `src/ui/swatch-picker.test.ts`

A generic button + dismissable popover + swatch grid. This is the
reusable unit #392's outline-colour picker will consume. It depends only
on `attachDismissablePopover` (existing) and takes its swatches/colours
as data.

- [ ] **Step 1: Write the failing test**

`src/ui/swatch-picker.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createSwatch,
    createSwatchGrid,
    createSwatchPicker,
    type SwatchEntry,
} from './swatch-picker.js';

const SWATCHES: SwatchEntry[] = [
    { id: 'a', label: 'Alpha', colour: '#ff0000' },
    { id: 'b', label: 'Beta', colour: '#00ff00' },
    { id: 'c', label: 'Gamma', colour: '#0000ff' },
];

describe('createSwatch', () => {
    it('creates a labelled button carrying the id and colour', () => {
        const swatch = createSwatch(SWATCHES[0], false);
        expect(swatch.tagName).toBe('BUTTON');
        expect(swatch.dataset.swatchId).toBe('a');
        expect(swatch.getAttribute('aria-label')).toBe('Alpha');
        expect(swatch.style.backgroundColor).toBeTruthy();
    });

    it('marks the selected swatch', () => {
        const swatch = createSwatch(SWATCHES[0], true);
        expect(swatch.classList.contains('swatch--selected')).toBe(true);
        expect(swatch.getAttribute('aria-selected')).toBe('true');
    });
});

describe('createSwatchGrid', () => {
    it('renders one option per entry and sets the column count', () => {
        const grid = createSwatchGrid(SWATCHES, 'b', vi.fn(), vi.fn(), {
            ariaLabel: 'Test',
            columnCount: 3,
        });
        expect(grid.querySelectorAll('button').length).toBe(3);
        expect(grid.getAttribute('aria-label')).toBe('Test');
        expect(grid.style.getPropertyValue('--swatch-columns')).toBe('3');
        const selected = grid.querySelector('.swatch--selected');
        expect((selected as HTMLElement).dataset.swatchId).toBe('b');
    });

    it('calls onSelect with the id and dismisses on click', () => {
        const onSelect = vi.fn();
        const onDismiss = vi.fn();
        const grid = createSwatchGrid(SWATCHES, 'a', onSelect, onDismiss, {
            ariaLabel: 'Test',
            columnCount: 3,
        });
        (grid.querySelector('[data-swatch-id="c"]') as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledWith('c');
        expect(onDismiss).toHaveBeenCalledOnce();
    });
});

describe('createSwatchPicker', () => {
    it('appends a button and toggles the grid open/closed', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();

        const cleanup = createSwatchPicker({
            container,
            button: { icon: '🎨', title: 'Colour', className: 'bg-colour-button' },
            ariaLabel: 'Colour',
            swatches: SWATCHES,
            selectedId: 'a',
            onSelect,
            columnCount: 3,
        });

        const button = container.querySelector('button.bg-colour-button') as HTMLButtonElement;
        expect(button).toBeTruthy();
        expect(container.querySelector('.swatch-grid')).toBeNull();

        button.click();
        expect(container.querySelector('.swatch-grid')).toBeTruthy();

        (container.querySelector('[data-swatch-id="b"]') as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledWith('b');

        cleanup();
        expect(container.querySelector('button.bg-colour-button')).toBeNull();
        document.body.removeChild(container);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/swatch-picker.test.ts`
Expected: FAIL — `Cannot find module './swatch-picker.js'`.

- [ ] **Step 3: Write the implementation**

`src/ui/swatch-picker.ts`:

```ts
/**
 * Reusable swatch-grid picker: a button that opens a dismissable popover
 * containing a grid of colour swatches. Selecting a swatch fires
 * `onSelect(id)` and closes the popover.
 *
 * The component is colour-source agnostic — callers pass swatches as
 * data — so it can back both the background-colour picker and the
 * piece-outline colour picker (#392).
 */

import { attachDismissablePopover } from './dismissable-overlay.js';

export interface SwatchEntry {
    /** Stable id reported to `onSelect`. */
    id: string;
    /** Accessible label / tooltip. */
    label: string;
    /** CSS colour value shown in the swatch. */
    colour: string;
}

export interface SwatchPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Trigger-button presentation. `className` carries positioning. */
    button: { icon: string; title: string; className: string };
    /** Accessible label for the grid (listbox). */
    ariaLabel: string;
    /** Swatches to render. */
    swatches: readonly SwatchEntry[];
    /** Currently selected swatch id. */
    selectedId: string;
    /** Called with the chosen swatch id. */
    onSelect: (id: string) => void;
    /** Grid column count (default 20). */
    columnCount?: number;
}

const DEFAULT_COLUMNS = 20;

/** Create a single swatch button. */
export function createSwatch(
    entry: SwatchEntry,
    isSelected: boolean,
): HTMLButtonElement {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.type = 'button';
    swatch.style.backgroundColor = entry.colour;
    swatch.setAttribute('role', 'option');
    swatch.setAttribute('aria-label', entry.label);
    swatch.setAttribute('aria-selected', String(isSelected));
    swatch.title = entry.label;
    swatch.dataset.swatchId = entry.id;

    if (isSelected) {
        swatch.classList.add('swatch--selected');
    }

    return swatch;
}

/** Create the grid panel (listbox of swatches). */
export function createSwatchGrid(
    swatches: readonly SwatchEntry[],
    selectedId: string,
    onSelect: (id: string) => void,
    onDismiss: () => void,
    opts: { ariaLabel: string; columnCount?: number },
): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', opts.ariaLabel);
    grid.style.setProperty(
        '--swatch-columns',
        String(opts.columnCount ?? DEFAULT_COLUMNS),
    );

    for (const entry of swatches) {
        const swatch = createSwatch(entry, entry.id === selectedId);
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(entry.id);
            onDismiss();
        });
        grid.appendChild(swatch);
    }

    return grid;
}

/**
 * Create and attach the swatch picker (button + popover). Returns a
 * cleanup function that removes the picker from the DOM.
 */
export function createSwatchPicker(options: SwatchPickerOptions): () => void {
    const { container, swatches, onSelect, ariaLabel, columnCount } = options;
    let currentId = options.selectedId;

    const button = document.createElement('button');
    button.className = options.button.className;
    button.type = 'button';
    button.title = options.button.title;
    button.setAttribute('aria-label', options.button.title);
    button.textContent = options.button.icon;

    let grid: HTMLDivElement | null = null;
    let dismissPopover: (() => void) | null = null;

    function dismissPanel(): void {
        if (dismissPopover) {
            dismissPopover();
            dismissPopover = null;
        }
        grid = null;
    }

    function showPanel(): void {
        if (grid) {
            dismissPanel();
            return;
        }

        grid = createSwatchGrid(
            swatches,
            currentId,
            (id) => {
                currentId = id;
                onSelect(id);
            },
            dismissPanel,
            { ariaLabel, columnCount },
        );

        button.after(grid);

        const handle = attachDismissablePopover({
            panel: grid,
            anchor: button,
            onDismiss: () => {
                grid = null;
                dismissPopover = null;
            },
        });
        dismissPopover = handle.dismiss;
    }

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        showPanel();
    });

    container.appendChild(button);

    return () => {
        dismissPanel();
        button.remove();
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/swatch-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/swatch-picker.ts src/ui/swatch-picker.test.ts
git commit -m "feat(ui): add reusable swatch-grid picker component (#391)"
```

---

## Task 4: Background-colour picker adapter

**Files:**
- Rewrite: `src/ui/background-colour-picker.ts`
- Rewrite: `src/ui/background-colour-picker.test.ts`

`createBackgroundColourPicker` keeps its public signature
(`BackgroundColourPickerOptions` with `container`, `selectedId`,
`onSelect`) and now delegates to `createSwatchPicker`.

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/ui/background-colour-picker.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the background colour picker adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundColourPicker } from './background-colour-picker.js';
import { BACKGROUND_COLOUR_PRESETS } from './background-colour.js';

describe('createBackgroundColourPicker', () => {
    it('adds the 🎨 button to the container', () => {
        const container = document.createElement('div');
        const cleanup = createBackgroundColourPicker({
            container,
            selectedId: BACKGROUND_COLOUR_PRESETS[0].id,
            onSelect: vi.fn(),
        });
        const button = container.querySelector('button.bg-colour-button');
        expect(button).toBeTruthy();
        cleanup();
    });

    it('opens a grid with one swatch per preset and reports selections', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();
        const cleanup = createBackgroundColourPicker({
            container,
            selectedId: 'indigo-darker',
            onSelect,
        });

        (container.querySelector('button.bg-colour-button') as HTMLButtonElement).click();
        const swatches = container.querySelectorAll('.swatch-grid .swatch');
        expect(swatches.length).toBe(BACKGROUND_COLOUR_PRESETS.length);

        (container.querySelector('[data-swatch-id="blue-default"]') as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledWith('blue-default');

        cleanup();
        document.body.removeChild(container);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/background-colour-picker.test.ts`
Expected: FAIL — old `createBackgroundColourPicker` builds `.bg-colour-panel`/`.bg-colour-swatch`, not `.swatch-grid`/`.swatch`; and the old test imported removed `createSwatch`/`createPickerPanel`.

- [ ] **Step 3: Write the implementation**

Replace the contents of `src/ui/background-colour-picker.ts`:

```ts
/**
 * Background colour picker — the 🎨 toolbar button that opens a swatch
 * grid for changing the puzzle table background. A thin adapter over the
 * reusable `createSwatchPicker`, feeding it the extended palette.
 */

import { BACKGROUND_COLOUR_PRESETS } from './background-colour.js';
import { createSwatchPicker } from './swatch-picker.js';

export interface BackgroundColourPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected colour id. */
    selectedId: string;
    /** Called when the player selects a colour. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create and attach the background colour picker (button + popover).
 * Returns a cleanup function that removes the picker from the DOM.
 */
export function createBackgroundColourPicker(
    options: BackgroundColourPickerOptions,
): () => void {
    return createSwatchPicker({
        container: options.container,
        button: {
            icon: '🎨',
            title: 'Background colour',
            className: 'bg-colour-button',
        },
        ariaLabel: 'Background colour',
        swatches: BACKGROUND_COLOUR_PRESETS,
        selectedId: options.selectedId,
        onSelect: options.onSelect,
        columnCount: 20,
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/background-colour-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the picker no longer references removed symbols).

- [ ] **Step 6: Commit**

```bash
git add src/ui/background-colour-picker.ts src/ui/background-colour-picker.test.ts
git commit -m "refactor(ui): make background picker a thin swatch-picker adapter (#391)"
```

---

## Task 5: Index exports

**Files:**
- Modify: `src/ui/index.ts:104-105`

`BACKGROUND_COLOUR_PRESETS`, `getColourPreset`, etc. are still exported
from `./background-colour.js` (unchanged names). Add the generic picker
export so #392 (and any consumer) can reach it.

- [ ] **Step 1: Edit the exports**

In `src/ui/index.ts`, replace lines 104-105:

```ts
export { createBackgroundColourPicker } from './background-colour-picker.js';
export type { BackgroundColourPickerOptions } from './background-colour-picker.js';
```

with:

```ts
export { createBackgroundColourPicker } from './background-colour-picker.js';
export type { BackgroundColourPickerOptions } from './background-colour-picker.js';

export {
    createSwatchPicker,
    createSwatchGrid,
    createSwatch,
} from './swatch-picker.js';
export type { SwatchEntry, SwatchPickerOptions } from './swatch-picker.js';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/index.ts
git commit -m "chore(ui): export the reusable swatch picker (#391)"
```

---

## Task 6: OS colour-scheme reactivity in main

**Files:**
- Modify: `src/main.ts:24-57` (import block) and `src/main.ts:1198-1209` (picker setup)

When the OS theme flips, the chosen background must re-resolve (hue
dimming) and the UI-chrome scheme recompute. Track the current id and
re-apply on `onColorSchemeChange`.

- [ ] **Step 1: Add the import**

In `src/main.ts`, inside the `from './ui/index.js'` import block
(currently lines 24-57), add `onColorSchemeChange` — e.g. immediately
after `applyBackgroundColour,` on line 30:

```ts
    applyBackgroundColour,
    onColorSchemeChange,
```

Also export `onColorSchemeChange` from `src/ui/index.ts` if not already:
in the `./background-colour.js` export group (lines 82-89), add it.

```ts
export {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_ID,
    getColourPreset,
    saveColourPreference,
    loadColourPreference,
    applyBackgroundColour,
} from './background-colour.js';
export { onColorSchemeChange } from './palette.js';
```

- [ ] **Step 2: Track the id and re-apply on scheme change**

In `src/main.ts`, replace the picker-setup block (currently lines
1198-1209):

```ts
// Set up the Background Colour picker
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

with:

```ts
// Set up the Background Colour picker
let currentColourId = loadColourPreference();
applyBackgroundColour(currentColourId);

// Re-resolve the background (hue dimming) and UI-chrome scheme when the
// OS colour-scheme flips between light and dark.
onColorSchemeChange(() => applyBackgroundColour(currentColourId));

createBackgroundColourPicker({
    container: app,
    selectedId: currentColourId,
    onSelect: (id) => {
        currentColourId = id;
        saveColourPreference(id);
        applyBackgroundColour(id);
    },
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/ui/index.ts
git commit -m "feat(palette): re-apply background on OS colour-scheme change (#391)"
```

---

## Task 7: Grid layout CSS

**Files:**
- Modify: `src/style.css` — replace `.bg-colour-panel`/`.bg-colour-swatch` rules (~lines 874-919), add `.swatch-grid`/`.swatch`; update the mobile media query (~lines 1228-1229).

The panel must be wide enough for 20 columns and clamp to the viewport
so it never overflows on mobile (the old 6-column corner panel would).
Keep `.bg-colour-button` positioning and the `.bg-colour-panel` token
block (~line 541) — the panel now also carries the `.swatch-grid` class
via `createSwatchGrid`, but the background picker's positioning lives on
`.swatch-grid` here. Since the generic grid has no app-specific position,
position `.swatch-grid` for the background picker directly.

- [ ] **Step 1: Replace the panel/swatch appearance rules**

In `src/style.css`, replace the block from `/* Background colour picker panel */`
through the `.bg-colour-swatch--selected:hover { ... }` rule
(currently `.bg-colour-panel` at ~line 874 to ~line 919) with:

```css
/* Reusable swatch-grid popover (background picker, outline picker …) */
.swatch-grid {
  position: absolute;
  top: 132px;
  right: 8px;
  z-index: 10000;
  display: grid;
  grid-template-columns: repeat(var(--swatch-columns, 20), minmax(0, 1fr));
  gap: 4px;
  width: min(440px, calc(100vw - 16px));
  padding: 8px;
  background: rgba(30, 30, 50, 0.95);
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: fade-in 0.15s ease-out;
}

.swatch {
  aspect-ratio: 1;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.1s ease;
  touch-action: manipulation;
}

.swatch:hover {
  border-color: var(--ui-muted);
  transform: scale(1.15);
}

.swatch:active {
  transform: scale(0.95);
}

.swatch--selected {
  border-radius: 50%;
  border-color: rgba(100, 160, 255, 0.9);
  box-shadow: 0 0 0 2px rgba(100, 160, 255, 0.4);
}

.swatch--selected:hover {
  border-color: rgba(100, 160, 255, 1);
}
```

- [ ] **Step 2: Update the `.bg-colour-panel` token block**

The `.bg-colour-panel` token block (~line 541) provides `--ui-*` values
so the panel's swatch borders are consistent against its dark background.
Rename its selector from `.bg-colour-panel` to `.swatch-grid` so the
tokens apply to the new grid. (Find the block beginning `.bg-colour-panel {`
with `--ui-fg: #e0e0e0;` and the overlay/border token list — change only
the selector line.)

```css
.swatch-grid {
  --ui-fg: #e0e0e0;
  --ui-overlay-subtle: rgba(255, 255, 255, 0.05);
  /* …unchanged token list… */
}
```

- [ ] **Step 3: Update the mobile media query**

In `src/style.css`, replace (currently ~lines 1228-1229):

```css
  .bg-colour-button { top: 96px; right: 8px; }
  .bg-colour-panel { top: 96px; right: 46px; }
```

with:

```css
  .bg-colour-button { top: 96px; right: 8px; }
  .swatch-grid { top: 96px; right: 8px; }
```

- [ ] **Step 4: Confirm no stale references**

Run: `grep -n "bg-colour-panel\|bg-colour-swatch" src/style.css`
Expected: no matches (all renamed to `.swatch-grid` / `.swatch`).

- [ ] **Step 5: Typecheck + tests (sanity)**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (CSS isn't typechecked, but confirm nothing broke).

- [ ] **Step 6: Commit**

```bash
git add src/style.css
git commit -m "style(palette): swatch-grid layout for the extended palette (#391)"
```

---

## Task 8: Manual verification & final check

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green; build succeeds.

- [ ] **Step 2: Run the app and verify (use the `run` or `verify` skill)**

Start the dev server (`npm run dev`) and confirm:
- The 🎨 button opens a popover showing a 20-column grid of 100 swatches,
  laid out as 5 tone rows.
- The popover fits within the viewport at a narrow (mobile) width — no
  horizontal overflow, no scroll.
- Clicking a swatch changes the table background immediately and marks
  the swatch selected (circle).
- Reloading keeps the chosen colour; clearing it / an old saved value
  resolves to `indigo-darker` (a dark navy) with light UI chrome.
- Toggling the OS between light and dark mode re-resolves the background
  (slightly dimmer hues in dark) without a reload.

- [ ] **Step 3: Push and open the PR**

Per repo conventions (rebase-and-merge, closing keyword at top of body):

```bash
git push -u origin feat/extended-palette-picker-391
gh pr create --title "feat: extended-palette background colour picker" --body "$(cat <<'EOF'
Closes #391

Replaces the 12 hardcoded background presets with the full lime-elements
extended palette (20 hues × 5 tones = 100 colours), referenced by name,
with OS dark-mode dimming. The picker UI is factored into a reusable
`createSwatchPicker` for the outline-colour picker (#392) to consume.

- No back-compat for the old presets (per #391): unrecognised saved
  values fall back to the new default `indigo-darker`.
- Contrast greyscale intentionally excluded (the `gray` hue covers greys).
- Help text unchanged (the toolbar line still reads "Change table colour").

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review notes

- **Spec coverage:** palette data + exclusions (Task 1), name-keyed ids &
  no-migration persistence & default (Task 2), reusable picker (Task 3),
  adapter (Task 4), exports (Task 5), OS reactivity (Task 6), grid layout
  & viewport clamp (Task 7), no help-text change (called out in Task 8 PR
  body / spec). All covered.
- **Type consistency:** `SwatchEntry` (`id`/`label`/`colour`) is the grid
  contract; `BackgroundColourPreset` shares that shape so presets pass
  straight through. `createSwatch`/`createSwatchGrid`/`createSwatchPicker`
  names are consistent across Tasks 3–5. `onColorSchemeChange` is defined
  in Task 1, exported in Task 6.
- **No placeholders:** every code step shows full code; commands have
  expected output.
```
