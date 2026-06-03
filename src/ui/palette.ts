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
