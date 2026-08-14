/**
 * Color values live in `src/palette.css` as CSS custom properties with a
 * dark-mode override; swatches reference `var(--color-<id>)` so the OS
 * light/dark flip is handled entirely by CSS.
 */

export const PALETTE_HUES = [
    'red', 'pink', 'magenta', 'purple', 'violet', 'indigo', 'blue', 'sky',
    'cyan', 'teal', 'green', 'lime', 'grass', 'yellow', 'amber', 'orange',
    'coral', 'brown', 'gray', 'glaucous',
] as const;

export const PALETTE_TONES = [
    'lighter', 'light', 'default', 'dark', 'darker', 'darker-2', 'darker-3',
] as const;

export type PaletteHue = (typeof PALETTE_HUES)[number];
export type PaletteTone = (typeof PALETTE_TONES)[number];

export interface PaletteSwatch {
    /** Stable id, "<hue>-<tone>", e.g. "blue-default". */
    id: string;
    /** Human label, "<hue> <tone>", e.g. "blue default". */
    label: string;
    /** CSS color: a reference to the palette variable, "var(--color-<id>)". */
    color: string;
}

/**
 * Tone-major order: with a 20-column grid, rows = tones, columns = hues. Shape
 * matches the swatch picker's `SwatchEntry`, so these feed `createSwatchPicker`
 * directly.
 */
export const PALETTE_SWATCHES: readonly PaletteSwatch[] = PALETTE_TONES.flatMap(
    (tone) =>
        PALETTE_HUES.map((hue) => ({
            id: `${hue}-${tone}`,
            label: `${hue} ${tone}`,
            color: `var(--color-${hue}-${tone})`,
        })),
);

/**
 * Fires on each subsequent change only, NOT on subscription — apply the current
 * scheme once yourself first. No-op (with no-op unsubscribe) when `matchMedia`
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
