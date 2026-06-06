# Extended-Palette Background Colour Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 12 hardcoded background presets with the full lime-elements extended palette (100 colours: 20 hues × 5 tones), with OS dark-mode dimming, referenced by name, and factor the picker UI into a reusable swatch-grid component (for #392).

**Architecture:** The colour values live as CSS custom properties in a new `src/palette.css` — `:root` holds the light values, a `@media (prefers-color-scheme: dark)` block redefines each to its dark shade, so the whole app flips light/dark **for free via CSS** (the lime-elements approach). `palette.ts` holds only swatch *metadata* (id, label, and a `var(--color-<id>)` reference) plus `onColorSchemeChange`. `background-colour.ts` derives its presets from that metadata (each `colour` is a variable reference, so swatches and the background flip automatically — no staleness) and persists the chosen id as a validated string (no legacy migration). The only JS that reacts to the OS theme is recomputing the luminance-derived `data-ui-scheme` chrome, read from `getComputedStyle`. A generic `swatch-picker.ts` builds the button + popover + grid; `background-colour-picker.ts` is a thin adapter over it.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), plain DOM, CSS custom properties, CSS grid.

**Spec:** `docs/superpowers/specs/2026-06-03-extended-palette-picker-design.md`

> **Follow-up (2026-06-04):** after the initial 5-tone build landed, each
> column was extended with two extrapolated darker rows (`darker-2`,
> `darker-3`) — see the spec's "Extra darker rows" section. The tasks
> below describe the original 5-tone palette (100 swatches); the shipped
> palette is 7 tones (140 swatches). `PALETTE_TONES`, `palette.css` (both
> blocks), and the `100`→`140` count assertions in `palette.test.ts` /
> `background-colour.test.ts` were updated accordingly.
>
> **Follow-up (2026-06-06):** old-preference migration was re-added —
> `loadColourPreference` maps a pre-switch saved value (old preset id or
> integer index) to its nearest new swatch via `LEGACY_COLOUR_MAP`. So
> Task 2's embedded "there is no migration" comment is historical; the
> shipped module migrates. See the spec's persistence section.

**Commands:**
- Single test file: `npx vitest run src/ui/<file>.test.ts`
- All tests: `npm test`
- Typecheck: `npx tsc --noEmit`

---

## File Structure

- **Create** `src/palette.css` — 100 hue variables on `:root` + a `@media (prefers-color-scheme: dark)` override. Source of truth for colour values.
- **Create** `src/ui/palette.ts` — swatch metadata (id, label, `var(--color-<id>)`) + `onColorSchemeChange`. No colour values.
- **Create** `src/ui/palette.test.ts` — palette shape/ordering tests + a structural check that `palette.css` defines every variable in both blocks.
- **Create** `src/ui/swatch-picker.ts` — reusable button + popover + swatch grid.
- **Create** `src/ui/swatch-picker.test.ts` — generic picker tests.
- **Rewrite** `src/ui/background-colour.ts` — presets from palette metadata (variable references); string-validated persistence; `applyBackgroundColour` sets the variable reference and derives `data-ui-scheme` from the resolved colour.
- **Rewrite** `src/ui/background-colour.test.ts` — persistence/apply tests (already exists in the repo).
- **Rewrite** `src/ui/background-colour-picker.ts` — thin adapter over `createSwatchPicker`.
- **Rewrite** `src/ui/background-colour-picker.test.ts` — adapter tests.
- **Modify** `src/ui/index.ts` — export `createSwatchPicker`; keep existing background exports.
- **Modify** `src/main.ts` — `import './palette.css'`; register an OS-scheme listener that re-applies the background (to refresh the chrome scheme).
- **Modify** `src/style.css` — reusable `.swatch-grid` / `.swatch` rules; widen + viewport-clamp the panel.

> Note: `BackgroundColourPreset` keeps its current shape (`{ id, label, colour }`) so `src/ui/index.ts`'s `export type { BackgroundColourPreset }` and any consumer stay valid. `colour` is now a `var(--color-<id>)` reference (CSS resolves it live), not a literal hex.

---

## Task 1: Palette colour variables + metadata

**Files:**
- Create: `src/palette.css`
- Create: `src/ui/palette.ts`
- Test: `src/ui/palette.test.ts`

The colour *values* live in `src/palette.css` as CSS custom properties with a `@media (prefers-color-scheme: dark)` override (the lime-elements approach — the whole app flips light/dark for free). `palette.ts` holds only swatch metadata + an OS-scheme change hook.

- [ ] **Step 1: Write the failing test** — `src/ui/palette.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    PALETTE_HUES,
    PALETTE_TONES,
    PALETTE_SWATCHES,
    onColorSchemeChange,
} from './palette.js';

describe('PALETTE_SWATCHES', () => {
    it('contains one entry per hue × tone (100)', () => {
        expect(PALETTE_HUES.length).toBe(20);
        expect(PALETTE_TONES.length).toBe(5);
        expect(PALETTE_SWATCHES.length).toBe(100);
    });

    it('uses "<hue>-<tone>" ids, "<hue> <tone>" labels, var() values', () => {
        const blue = PALETTE_SWATCHES.find((s) => s.id === 'blue-default');
        expect(blue).toBeDefined();
        expect(blue?.label).toBe('blue default');
        expect(blue?.value).toBe('var(--color-blue-default)');
    });

    it('has unique ids', () => {
        const ids = new Set(PALETTE_SWATCHES.map((s) => s.id));
        expect(ids.size).toBe(PALETTE_SWATCHES.length);
    });

    it('is ordered tone-major (rows = tones, columns = hues)', () => {
        const firstRow = PALETTE_SWATCHES.slice(0, 20);
        expect(firstRow.every((s) => s.id.endsWith('-lighter'))).toBe(true);
        expect(firstRow[0].id).toBe(`${PALETTE_HUES[0]}-lighter`);
    });
});

describe('palette.css', () => {
    const css = readFileSync(
        fileURLToPath(new URL('../palette.css', import.meta.url)),
        'utf8',
    );
    const darkBlock = css.slice(css.indexOf('prefers-color-scheme'));

    it('defines every swatch variable in :root (light)', () => {
        for (const s of PALETTE_SWATCHES) {
            const name = s.value.slice('var('.length, -1); // --color-<id>
            expect(css).toContain(`${name}:`);
        }
    });

    it('redefines every swatch variable in the dark-mode block', () => {
        expect(css).toContain('prefers-color-scheme: dark');
        for (const s of PALETTE_SWATCHES) {
            const name = s.value.slice('var('.length, -1);
            expect(darkBlock).toContain(`${name}:`);
        }
    });
});

describe('onColorSchemeChange', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('subscribes/unsubscribes to the change event', () => {
        const add = vi.fn();
        const remove = vi.fn();
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener: add,
            removeEventListener: remove,
        }));
        const cb = vi.fn();
        const off = onColorSchemeChange(cb);
        expect(add).toHaveBeenCalledWith('change', cb);
        off();
        expect(remove).toHaveBeenCalledWith('change', cb);
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

- [ ] **Step 3a: Write `src/palette.css`**

Create `src/palette.css` with two blocks. The `:root` block has one
`--color-<hue>-<tone>: <hex>;` line per value in the **LIGHT** table
below; the `@media (prefers-color-scheme: dark) { :root { … } }` block
has one line per value in the **DARK** table. Each table row is a hue
followed by its five tone values **in this fixed order**:
`[lighter, light, default, dark, darker]`. So `red: [#ffcdd2, …]`
expands to `--color-red-lighter: #ffcdd2;`, `--color-red-light: …`, etc.

Exact shape (first lines shown; expand to all 20 hues × 5 tones in both
blocks):

```css
/**
 * Extended color palette ported from lime-elements'
 * color-palette-extended.css (hues only — brand colors, absolute
 * white/black, and the contrast grayscale are excluded). Light values on
 * :root; the dark-mode override redefines each to its dimmer dark shade,
 * so anything using var(--color-*) flips with the OS theme for free.
 */

:root {
  --color-red-lighter: #ffcdd2;
  --color-red-light: #ff756b;
  --color-red-default: #f44336;
  --color-red-dark: #d32f2f;
  --color-red-darker: #b71c1c;
  /* …remaining hues… */
  --color-glaucous-darker: #254758;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-red-lighter: #ef9a9a;
    --color-red-light: #f05750;
    --color-red-default: #e53935;
    --color-red-dark: #c62828;
    --color-red-darker: #a51717;
    /* …remaining hues… */
    --color-glaucous-darker: #224150;
  }
}
```

**LIGHT** (`:root`) — `hue: [lighter, light, default, dark, darker]`:

```
red:      #ffcdd2  #ff756b  #f44336  #d32f2f  #b71c1c
pink:     #f8bbd0  #f06292  #e91e63  #c2185b  #880e4f
magenta:  #f9b0d4  #f759a6  #f34197  #c72e79  #9c1657
purple:   #e1bee7  #ba68c8  #9c27b0  #7b1fa2  #4a148c
violet:   #d1c4e9  #9575cd  #673ab7  #512da8  #311b92
indigo:   #c5cae9  #7986cb  #3f51b5  #303f9f  #1a237e
blue:     #bbdefb  #64b5f6  #2196f3  #1976d2  #0d47a1
sky:      #b3e5fc  #4fc3f7  #03a9f4  #0288d1  #01579b
cyan:     #b2ebf2  #4dd0e1  #00bcd4  #0097a7  #006064
teal:     #b2dfdb  #4db6ac  #009688  #00796b  #004d40
green:    #c8e6c9  #81c784  #4caf50  #388e3c  #1b5e20
lime:     #dcedc8  #aed581  #8bc34a  #689f38  #33691e
grass:    #f0f4c3  #dce775  #cddc39  #afb42b  #827717
yellow:   #fff9c4  #fff176  #ffeb3b  #fbce2c  #e8bf29
amber:    #ffecb3  #ffd54f  #ffc107  #ffa000  #ff6f00
orange:   #ffe0b2  #ffb74d  #ff9800  #f57c00  #e65100
coral:    #ffccbc  #ff8a65  #ff5722  #e64a19  #bf360c
brown:    #d7ccc8  #a1887f  #795548  #5d4037  #3e2723
gray:     #f5f5f5  #e0e0e0  #9e9e9e  #575756  #212121
glaucous: #d0e1e8  #87aec1  #57879f  #3a6477  #254758
```

**DARK** (`@media (prefers-color-scheme: dark)`):

```
red:      #ef9a9a  #f05750  #e53935  #c62828  #a51717
pink:     #f48fb1  #ec407a  #d81b60  #ad1457  #840a4b
magenta:  #f9a1cc  #f94fa2  #ff3195  #d01f75  #9c1657
purple:   #ce93d8  #ab47bc  #8e24aa  #6a1b9a  #3e0d79
violet:   #b39ddb  #7e57c2  #5e35b1  #4527a0  #29167f
indigo:   #9fa8da  #5c6bc0  #3949ab  #283593  #151e73
blue:     #90caf9  #42a5f5  #1e88e5  #1565c0  #0a3c8a
sky:      #81d4fa  #29b6f6  #039be5  #0277bd  #015190
cyan:     #80deea  #26c6da  #00acc1  #00838f  #00595d
teal:     #80cbc4  #26a69a  #00897b  #00695c  #015245
green:    #a5d6a7  #66bb6a  #43a047  #2e7d32  #206125
lime:     #c5e1a5  #9ccc65  #7cb342  #558b2f  #2b5a19
grass:    #e6ee9c  #d4e157  #c0ca33  #9e9d24  #776d13
yellow:   #fff59d  #ffee58  #fdd835  #f5c827  #e0b415
amber:    #ffe082  #ffcf3d  #ffb03b  #ff8f00  #de6202
orange:   #ffcc80  #ffa726  #fb8c00  #ef6c00  #d84d01
coral:    #ffab91  #ff7043  #f4511e  #d84315  #b5320a
brown:    #bcaaa4  #8d6e63  #6d4c41  #4e342e  #33201c
gray:     #eeeeee  #adadad  #757575  #424242  #212020
glaucous: #9fc2d0  #6e8d9c  #446c80  #2a576b  #224150
```

- [ ] **Step 3b: Write `src/ui/palette.ts`**

```ts
/**
 * Extended color palette metadata. The color *values* live in
 * `src/palette.css` as CSS custom properties (with a dark-mode override),
 * so anything that renders a swatch references `var(--color-<id>)` and the
 * OS light/dark flip is handled entirely by CSS. This module only
 * enumerates the swatches and exposes an OS-scheme change hook used to
 * refresh the luminance-derived UI chrome.
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
    /** CSS value: a reference to the palette variable, "var(--color-<id>)". */
    value: string;
}

/**
 * All swatches in tone-major order: the "lighter" tone of every hue
 * first, then "light", etc. With a 20-column grid this lays out as rows
 * = tones, columns = hues (mirrors the limel-color-picker layout).
 */
export const PALETTE_SWATCHES: readonly PaletteSwatch[] = PALETTE_TONES.flatMap(
    (tone) =>
        PALETTE_HUES.map((hue) => ({
            id: `${hue}-${tone}`,
            label: `${hue} ${tone}`,
            value: `var(--color-${hue}-${tone})`,
        })),
);

/**
 * Subscribe to OS color-scheme changes. The callback fires on each
 * subsequent change only — it is NOT invoked on subscription, so apply
 * the current scheme once yourself before subscribing. Returns an
 * unsubscribe function. No-op (and a no-op unsubscribe) when `matchMedia`
 * is unavailable (e.g. jsdom).
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
Expected: PASS (the `palette.css` structural checks confirm every variable exists in both blocks).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/palette.css src/ui/palette.ts src/ui/palette.test.ts
git commit -m "feat(palette): add extended palette CSS variables and swatch metadata (#391)"
```

---

## Task 2: Background-colour presets & persistence

**Files:**
- Rewrite: `src/ui/background-colour.ts`
- Rewrite: `src/ui/background-colour.test.ts` (already exists)

Presets are derived from the palette metadata; each `colour` is a
`var(--color-<id>)` reference (so swatches/background flip with the OS
theme via CSS — no staleness). Persistence is a validated string (no
legacy migration). `applyBackgroundColour` sets the variable reference,
then derives the luminance-based `data-ui-scheme` from the **resolved**
colour read via `getComputedStyle`.

- [ ] **Step 1: Write the failing test** — replace the contents of `src/ui/background-colour.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
    it('exposes the full palette (100 presets)', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBe(100);
    });

    it('each preset colour is a var(--color-…) reference', () => {
        for (const p of BACKGROUND_COLOUR_PRESETS) {
            expect(p.colour).toMatch(/^var\(--color-[a-z]+-[a-z]+\)$/);
        }
    });

    it('default id resolves to a preset', () => {
        expect(
            BACKGROUND_COLOUR_PRESETS.some((p) => p.id === DEFAULT_COLOUR_ID),
        ).toBe(true);
    });
});

describe('getColourPreset', () => {
    it('returns the matching preset', () => {
        const preset = getColourPreset('blue-default');
        expect(preset.id).toBe('blue-default');
        expect(preset.colour).toBe('var(--color-blue-default)');
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
    it('classifies rgb() strings (from getComputedStyle)', () => {
        expect(isLightColour('rgb(245, 245, 245)')).toBe(true);
        expect(isLightColour('rgb(26, 35, 126)')).toBe(false);
    });

    it('classifies hex strings', () => {
        expect(isLightColour('#ffffff')).toBe(true);
        expect(isLightColour('#000000')).toBe(false);
    });

    it('treats an unparseable colour as dark', () => {
        expect(isLightColour('')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
        delete document.documentElement.dataset.uiScheme;
    });
    afterEach(() => vi.restoreAllMocks());

    it('sets the custom property to the variable reference', () => {
        applyBackgroundColour('blue-default');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-blue-default)');
    });

    it('sets a light ui-scheme when the resolved colour is light', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: 'rgb(245, 245, 245)',
        } as CSSStyleDeclaration);
        applyBackgroundColour('gray-lighter');
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });

    it('sets a dark ui-scheme when the resolved colour is dark', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: 'rgb(26, 35, 126)',
        } as CSSStyleDeclaration);
        applyBackgroundColour('indigo-darker');
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });

    it('falls back to the default preset for an unknown id', () => {
        applyBackgroundColour('not-a-colour');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(`var(--color-${DEFAULT_COLOUR_ID})`);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/background-colour.test.ts`
Expected: FAIL — the old module exports 12 presets with hex colours; the 100-count and `var(--color-…)` assertions fail.

- [ ] **Step 3: Write the implementation** — replace the ENTIRE contents of `src/ui/background-colour.ts`:

```ts
/**
 * Background color presets and persistence.
 *
 * Presets are the full extended palette (see `palette.ts` / `palette.css`).
 * Each preset's `colour` is a `var(--color-<id>)` reference, so the chosen
 * background and every swatch flip between light/dark shades with the OS
 * theme automatically. The chosen preset is saved by its stable string id;
 * there is no migration from the old index-based or named presets — an
 * unrecognized saved value falls back to the default.
 */

import { createStringPreference } from './preference-store.js';
import { PALETTE_SWATCHES, type PaletteSwatch } from './palette.js';

export interface BackgroundColourPreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label, e.g. "blue default". */
    label: string;
    /** CSS color value — a `var(--color-<id>)` reference. */
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

const defaultSwatch = swatchById.get(DEFAULT_COLOUR_ID);
if (defaultSwatch === undefined) {
    throw new Error(
        `DEFAULT_COLOUR_ID '${DEFAULT_COLOUR_ID}' is not a palette swatch id`,
    );
}

function toPreset(swatch: PaletteSwatch): BackgroundColourPreset {
    return { id: swatch.id, label: swatch.label, colour: swatch.value };
}

/** Available background colour presets (the full palette). */
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

/** Get the preset for an id, or the default preset for an unknown id. */
export function getColourPreset(id: string): BackgroundColourPreset {
    return toPreset(swatchById.get(id) ?? defaultSwatch);
}

/**
 * Parse a CSS color string (`rgb()`/`rgba()` from getComputedStyle, or a
 * 6-digit hex) into [r, g, b], or null if unrecognized.
 */
function parseRgb(colour: string): [number, number, number] | null {
    const rgb = colour.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }
    const hex = colour.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = hex[1];
        return [
            parseInt(n.slice(0, 2), 16),
            parseInt(n.slice(2, 4), 16),
            parseInt(n.slice(4, 6), 16),
        ];
    }
    return null;
}

/**
 * Determine whether a color is perceptually light (relative luminance >
 * 0.4). Accepts an `rgb()/rgba()` string or a hex string; an unparseable
 * value is treated as dark.
 */
export function isLightColour(colour: string): boolean {
    const parsed = parseRgb(colour);
    if (parsed === null) {
        return false;
    }
    const [r, g, b] = parsed.map((v) => v / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4;
}

/**
 * Apply a background colour to the document root. The colour itself is a
 * CSS variable reference (so it flips with the OS theme via CSS); the
 * luminance-derived `data-ui-scheme` chrome is computed here from the
 * resolved colour.
 */
export function applyBackgroundColour(id: string): void {
    const preset = getColourPreset(id);
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    document.body.style.backgroundColor = preset.colour;

    const resolved = getComputedStyle(document.body).backgroundColor;
    document.documentElement.dataset.uiScheme = isLightColour(resolved)
        ? 'light'
        : 'dark';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/background-colour.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The old `background-colour-picker.ts` still imports
`BACKGROUND_COLOUR_PRESETS` / `BackgroundColourPreset`, which keep their
names and `{ id, label, colour }` shape, so it still compiles — it is
replaced in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/background-colour.ts src/ui/background-colour.test.ts
git commit -m "feat(palette): derive background presets as palette variable refs (#391)"
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
- Modify: `src/main.ts` (add the `palette.css` import; the import block; the picker setup)
- Modify: `src/ui/index.ts` (export `onColorSchemeChange`)

The background **colour** flips with the OS theme for free via CSS (the
preset is a `var(--color-…)` reference). The only thing JS must do on a
flip is recompute the luminance-derived `data-ui-scheme` chrome — so we
track the current id and re-apply on `onColorSchemeChange`.

- [ ] **Step 0: Import the palette stylesheet**

In `src/main.ts`, near the top with the other side-effect imports (e.g.
wherever `./style.css` is imported — search for `style.css`), add:

```ts
import './palette.css';
```

If `style.css` is imported in `main.ts`, place `import './palette.css';`
immediately before it so the palette variables are defined before any
styles that might consume them. If `style.css` is NOT imported in
`main.ts`, add `@import './palette.css';` as the FIRST line of
`src/style.css` instead (CSS `@import` must precede all other rules).
Verify the variables load by checking the dev build in Task 8.

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

// The background colour flips with the OS theme via CSS; re-apply only
// to recompute the luminance-derived UI-chrome scheme on the flip.
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
