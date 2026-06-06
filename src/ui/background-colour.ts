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

import { diagnostics } from '../diagnostics.js';
import { createStringPreference } from './preference-store.js';
import { PALETTE_SWATCHES, type PaletteSwatch } from './palette.js';
import type { SwatchEntry } from './swatch-picker.js';

/**
 * A background preset is just a palette swatch (`{ id, label, colour }`,
 * where `colour` is a `var(--color-<id>)` reference). Aliased so the
 * public name stays meaningful while there's a single shape.
 */
export type BackgroundColourPreset = PaletteSwatch;

/** Default preset id — a fixed dark hue (closest to the old "midnight"). */
export const DEFAULT_COLOUR_ID = 'indigo-darker';

/** localStorage key for the saved background colour. */
export const COLOUR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-colour';

const swatchById = new Map<string, PaletteSwatch>(
    PALETTE_SWATCHES.map((s) => [s.id, s]),
);

const defaultSwatchOrUndef = swatchById.get(DEFAULT_COLOUR_ID);
if (defaultSwatchOrUndef === undefined) {
    throw new Error(
        `DEFAULT_COLOUR_ID '${DEFAULT_COLOUR_ID}' is not a palette swatch id`,
    );
}
const defaultSwatch: PaletteSwatch = defaultSwatchOrUndef;

/**
 * Available background colour presets (the full palette). `satisfies`
 * documents that a preset is a valid `SwatchEntry`, so it feeds the
 * swatch picker directly.
 */
export const BACKGROUND_COLOUR_PRESETS: readonly BackgroundColourPreset[] =
    PALETTE_SWATCHES satisfies readonly SwatchEntry[];

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
    return swatchById.get(id) ?? defaultSwatch;
}

/**
 * Parse a CSS color string (`rgb()`/`rgba()` from getComputedStyle, or a
 * 6-digit hex) into [r, g, b], or null if unrecognized.
 */
function parseRgb(colour: string): [number, number, number] | null {
    // Accept both legacy comma syntax `rgb(r, g, b)` and CSS Color Level 4
    // space syntax `rgb(r g b / a)`, with optional fractional channels.
    const rgb = colour.match(
        /rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)/i,
    );
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

    // `preset.colour` is a `var(--color-…)` reference, so reading it back
    // resolves to a concrete rgb() only once `palette.css` has loaded
    // (hence main.ts imports it before the app boots). If it's empty or
    // otherwise unparseable, `isLightColour` returns false → the chrome
    // silently defaults to dark; warn so a load-order or naming regression
    // is noticed rather than failing invisibly.
    const resolved = getComputedStyle(document.body).backgroundColor;
    if (parseRgb(resolved) === null) {
        diagnostics.warn(
            `applyBackgroundColour: could not parse resolved background ` +
                `"${resolved}" for "${preset.colour}" (is palette.css ` +
                `loaded?); defaulting UI chrome to dark`,
        );
    }
    document.documentElement.dataset.uiScheme = isLightColour(resolved)
        ? 'light'
        : 'dark';
}
