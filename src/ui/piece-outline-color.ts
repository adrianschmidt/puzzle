/**
 * Piece-outline color presets and persistence.
 *
 * The "Outline" piece-edge style draws a 1px silhouette whose color the
 * user picks from the extended palette (see `palette.ts` / `palette.css`).
 * Each preset's `color` is a `var(--color-<id>)` reference, so the chosen
 * outline color flips between light/dark shades with the OS theme for
 * free. The choice is saved by its stable string id.
 *
 * The localStorage key and CSS variable are scoped to the *outline* style
 * specifically (`puzzle-piece-outline-color` / `--piece-outline-color` —
 * the `puzzle-piece-<styleId>-color` convention). A future per-style
 * color (e.g. a Shadow color) is then a new, independent key: purely
 * additive, no migration.
 */

import { createStringPreference } from './preference-store.js';
import { PALETTE_SWATCHES, type PaletteSwatch } from './palette.js';
import type { SwatchEntry } from './swatch-picker.js';

/** An outline-color preset is a palette swatch (`{ id, label, color }`). */
export type PieceOutlineColorPreset = PaletteSwatch;

/**
 * Default outline color — near-black `gray-darker-3` (#080808). It's a
 * palette member (so it highlights as selected in the picker) and is
 * effectively black in both light and dark mode, matching the old
 * hardcoded outline.
 */
export const DEFAULT_PIECE_OUTLINE_COLOR_ID = 'gray-darker-3';

/** localStorage key for the saved outline color. */
export const PIECE_OUTLINE_COLOR_PREFERENCE_KEY = 'puzzle-piece-outline-color';

/** CSS custom property the outline filter's flood-color reads. */
export const CSS_CUSTOM_PROPERTY = '--piece-outline-color';

const swatchById = new Map<string, PaletteSwatch>(
    PALETTE_SWATCHES.map((s) => [s.id, s]),
);

const defaultSwatchOrUndef = swatchById.get(DEFAULT_PIECE_OUTLINE_COLOR_ID);
if (defaultSwatchOrUndef === undefined) {
    throw new Error(
        `DEFAULT_PIECE_OUTLINE_COLOR_ID '${DEFAULT_PIECE_OUTLINE_COLOR_ID}' is not a palette swatch id`,
    );
}
const defaultSwatch: PaletteSwatch = defaultSwatchOrUndef;

/**
 * Available outline colors (the full palette). `satisfies` documents that
 * a preset is a valid `SwatchEntry`, so it feeds the swatch picker directly.
 */
export const PIECE_OUTLINE_COLOR_PRESETS: readonly PieceOutlineColorPreset[] =
    PALETTE_SWATCHES satisfies readonly SwatchEntry[];

const ALLOWED_IDS = PALETTE_SWATCHES.map((s) => s.id);

const store = createStringPreference({
    key: PIECE_OUTLINE_COLOR_PREFERENCE_KEY,
    allowed: ALLOWED_IDS,
    defaultValue: DEFAULT_PIECE_OUTLINE_COLOR_ID,
});

export const savePieceOutlineColorPreference = store.save;
export const loadPieceOutlineColorPreference = store.load;

/** Get the preset for an id, or the default preset for an unknown id. */
export function getPieceOutlineColorPreset(
    id: string,
): PieceOutlineColorPreset {
    return swatchById.get(id) ?? defaultSwatch;
}

/**
 * Apply an outline color by writing its `var(--color-<id>)` reference to
 * the `--piece-outline-color` custom property on the document root, where
 * the SVG outline filter's flood-color reads it. CSS resolves the value
 * and flips it with the OS theme.
 */
export function applyPieceOutlineColor(id: string): void {
    const preset = getPieceOutlineColorPreset(id);
    document.documentElement.style.setProperty(
        CSS_CUSTOM_PROPERTY,
        preset.color,
    );
}
