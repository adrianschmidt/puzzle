/**
 * Background color presets and persistence.
 *
 * Presets are the full extended palette (see `palette.ts` / `palette.css`).
 * Each preset's `colour` is a `var(--color-<id>)` reference, so the chosen
 * background and every swatch flip between light/dark shades with the OS
 * theme automatically. The chosen preset is saved by its stable string id.
 * Preferences saved before the palette switch (an old preset id or an
 * even-older bare integer index) migrate to their nearest new swatch via
 * `LEGACY_COLOR_MAP`; anything unrecognized falls back to the default.
 */

import { diagnostics } from '../diagnostics.js';
import { createStringPreference } from './preference-store.js';
import { PALETTE_SWATCHES, type PaletteSwatch } from './palette.js';
import type { SwatchEntry } from './swatch-picker.js';

/**
 * A background preset is just a palette swatch (`{ id, label, colour }`,
 * where `colour` is a `var(--color-<id>)` reference). Aliased so the
 * public name stays meaningful while there's a single shape.
 */
export type BackgroundColorPreset = PaletteSwatch;

/** Default preset id — a fixed dark hue (closest to the old "midnight"). */
export const DEFAULT_COLOR_ID = 'indigo-darker';

/** localStorage key for the saved background color. */
export const COLOR_PREFERENCE_KEY = 'puzzle-background-color';

/**
 * Old localStorage key, from before the British→American spelling rename.
 * A returning user may still have their preference stored here, so it's
 * read at load time and migrated to {@link COLOR_PREFERENCE_KEY}.
 */
const LEGACY_COLOR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-color';

const swatchById = new Map<string, PaletteSwatch>(
    PALETTE_SWATCHES.map((s) => [s.id, s]),
);

const defaultSwatchOrUndef = swatchById.get(DEFAULT_COLOR_ID);
if (defaultSwatchOrUndef === undefined) {
    throw new Error(
        `DEFAULT_COLOR_ID '${DEFAULT_COLOR_ID}' is not a palette swatch id`,
    );
}
const defaultSwatch: PaletteSwatch = defaultSwatchOrUndef;

/**
 * Available background color presets (the full palette). `satisfies`
 * documents that a preset is a valid `SwatchEntry`, so it feeds the
 * swatch picker directly.
 */
export const BACKGROUND_COLOR_PRESETS: readonly BackgroundColorPreset[] =
    PALETTE_SWATCHES satisfies readonly SwatchEntry[];

const ALLOWED_IDS = PALETTE_SWATCHES.map((s) => s.id);

const store = createStringPreference({
    key: COLOR_PREFERENCE_KEY,
    allowed: ALLOWED_IDS,
    defaultValue: DEFAULT_COLOR_ID,
});

export const saveColorPreference = store.save;

/**
 * Migration for preferences saved before the palette switch. Each of the
 * old 12 preset ids maps to its nearest equivalent in the new palette, so
 * a returning user keeps a similar background instead of being reset to
 * the default. Curated for hue character rather than blind nearest:
 * neutral grays map to grays, tinted pastels stay in their hue family.
 */
const LEGACY_NEAREST: Record<string, string> = {
    midnight: 'indigo-darker',
    charcoal: 'gray-darker',
    slate: 'glaucous-dark',
    light: 'gray-light',
    wood: 'brown-dark',
    'green-felt': 'green-darker',
    'hot-pink': 'magenta-default',
    blush: 'red-lighter',
    peach: 'orange-lighter',
    sage: 'green-lighter',
    sky: 'blue-lighter',
    lavender: 'violet-lighter',
};

/**
 * Pre-id storage order: an even-older preference was a bare integer index
 * into this list, so `'3'` resolves to the same target as `'light'`.
 */
const LEGACY_ORDER = [
    'midnight', 'charcoal', 'slate', 'light', 'wood', 'green-felt',
    'hot-pink', 'blush', 'peach', 'sage', 'sky', 'lavender',
] as const;

/** Both old string ids and old integer indices → nearest new swatch id. */
const LEGACY_COLOR_MAP: Record<string, string> = {
    ...LEGACY_NEAREST,
    ...Object.fromEntries(
        LEGACY_ORDER.map((id, i) => [String(i), LEGACY_NEAREST[id]]),
    ),
};

// Fail fast in development if any migration target drifts off the palette.
// Iterate the assembled map (not just LEGACY_NEAREST) so an integer index
// pointing at a missing target surfaces as `undefined` here too.
for (const target of Object.values(LEGACY_COLOR_MAP)) {
    if (!swatchById.has(target)) {
        throw new Error(
            `Legacy migration target '${target}' is not a palette swatch id`,
        );
    }
}

/** Resolve a raw stored value to a valid swatch id, legacy-aware. */
function resolveStoredId(raw: string): string {
    if (Object.hasOwn(LEGACY_COLOR_MAP, raw)) {
        return LEGACY_COLOR_MAP[raw];
    }
    return ALLOWED_IDS.includes(raw) ? raw : DEFAULT_COLOR_ID;
}

/**
 * Load the saved background id. A current id loads as-is; a recognised
 * legacy value (old preset id or integer index) migrates to its nearest
 * new swatch; anything else falls back to the default.
 *
 * A preference still under the old British-spelling key is read once and
 * rewritten under {@link COLOR_PREFERENCE_KEY}, then the old key is dropped.
 */
export function loadColorPreference(): string {
    let raw: string | null;
    let fromLegacyKey = false;
    try {
        raw = localStorage.getItem(COLOR_PREFERENCE_KEY);
        if (raw === null) {
            raw = localStorage.getItem(LEGACY_COLOR_PREFERENCE_KEY);
            fromLegacyKey = raw !== null;
        }
    } catch {
        return DEFAULT_COLOR_ID;
    }
    if (raw === null) {
        return DEFAULT_COLOR_ID;
    }
    const resolved = resolveStoredId(raw);
    if (fromLegacyKey) {
        // One-time key migration: rewrite under the new key, drop the old.
        try {
            saveColorPreference(resolved);
            localStorage.removeItem(LEGACY_COLOR_PREFERENCE_KEY);
        } catch {
            // Best-effort; a failed write just retries on the next load.
        }
    }
    return resolved;
}

/** Get the preset for an id, or the default preset for an unknown id. */
export function getColorPreset(id: string): BackgroundColorPreset {
    return swatchById.get(id) ?? defaultSwatch;
}

/**
 * Parse a CSS color string (`rgb()`/`rgba()` from getComputedStyle, or a
 * 6-digit hex) into [r, g, b], or null if unrecognized.
 */
function parseRgb(color: string): [number, number, number] | null {
    // Accept both legacy comma syntax `rgb(r, g, b)` and CSS Color Level 4
    // space syntax `rgb(r g b / a)`, with optional fractional channels.
    const rgb = color.match(
        /rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)/i,
    );
    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }
    const hex = color.match(/^#([0-9a-f]{6})$/i);
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

/** Relative luminance > 0.4, from an already-parsed [r, g, b] (0–255). */
function luminanceIsLight([r, g, b]: [number, number, number]): boolean {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.4;
}

/**
 * Determine whether a color is perceptually light (relative luminance >
 * 0.4). Accepts an `rgb()/rgba()` string or a hex string; an unparseable
 * value is treated as dark.
 */
export function isLightColor(color: string): boolean {
    const parsed = parseRgb(color);
    return parsed !== null && luminanceIsLight(parsed);
}

/**
 * Apply a background color to the document root. The color itself is a
 * CSS variable reference (so it flips with the OS theme via CSS); the
 * luminance-derived `data-ui-scheme` chrome is computed here from the
 * resolved color.
 */
export function applyBackgroundColor(id: string): void {
    const preset = getColorPreset(id);
    // Drives the visible background — style.css applies it on :root.
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    // NOT redundant with the line above: this is the read-back target for the
    // chrome decision below. getComputedStyle(document.body) resolves this
    // assignment's var() to a concrete rgb(); without it body stays
    // transparent → rgba(0, 0, 0, 0) → chrome silently stuck on dark for every
    // color (and rgba(0,0,0,0) parses fine, so the warn below wouldn't even
    // fire). Don't "simplify" this away.
    document.body.style.backgroundColor = preset.colour;

    // `preset.colour` is a `var(--color-…)` reference, so reading it back
    // resolves to a concrete rgb() only once `palette.css` has loaded
    // (hence main.ts imports it before the app boots). If it's empty or
    // otherwise unparseable, `isLightColor` returns false → the chrome
    // silently defaults to dark; warn so a load-order or naming regression
    // is noticed rather than failing invisibly.
    const resolved = parseRgb(getComputedStyle(document.body).backgroundColor);
    if (resolved === null) {
        diagnostics.warn(
            `applyBackgroundColor: could not parse the resolved background ` +
                `for "${preset.colour}" (is palette.css loaded?); ` +
                `defaulting UI chrome to dark`,
        );
    }
    document.documentElement.dataset.uiScheme =
        resolved !== null && luminanceIsLight(resolved) ? 'light' : 'dark';
}
