/**
 * Piece-outline presets and persistence.
 *
 * Three modes for the resting-state edge effect on puzzle groups:
 * - "none":    no visible edge (uses `opacity(1)` as a no-op filter so it
 *              still composes with state-variant filters like `.selected`).
 * - "shadow":  symmetric soft drop-shadow (rotation-invariant).
 * - "outline": sharp 1px black silhouette via the SVG filter installed
 *              by `installPieceOutlineFilter` (piece-outline-filter.ts).
 *
 * The chosen filter value is written to the
 * `--piece-edge-filter` custom property on `documentElement`, where
 * `[data-group-id]` and its state variants read it via `var(...)`.
 */

import { createIdPreferenceStore } from './preference-store.js';

export interface PieceOutlinePreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label shown in the info modal. */
    label: string;
    /** Short description shown under the label. */
    description: string;
    /** CSS value applied to the --piece-edge-filter custom property. */
    filter: string;
}

export const PIECE_OUTLINE_PRESETS: readonly PieceOutlinePreset[] = [
    {
        id: 'none',
        label: 'None',
        description: 'No edge',
        // `opacity(1)` is a no-op filter function. We use it instead of the
        // bare `none` keyword so the value composes with state-variant
        // filters (e.g. `.selected`'s blue glow). `filter: none drop-shadow(...)`
        // is invalid CSS — the whole declaration gets dropped.
        filter: 'opacity(1)',
    },
    {
        id: 'shadow',
        label: 'Shadow',
        description: 'Soft halo',
        filter: 'drop-shadow(0 0 4px rgba(0, 0, 0, 0.35))',
    },
    {
        id: 'outline',
        label: 'Outline',
        description: 'Sharp 1px line',
        filter: 'url(#piece-outline)',
    },
] as const;

export const DEFAULT_PIECE_OUTLINE_ID = 'shadow';
export const PIECE_OUTLINE_PREFERENCE_KEY = 'puzzle-piece-outline';
export const CSS_CUSTOM_PROPERTY = '--piece-edge-filter';

const store = createIdPreferenceStore({
    key: PIECE_OUTLINE_PREFERENCE_KEY,
    presets: PIECE_OUTLINE_PRESETS,
    defaultId: DEFAULT_PIECE_OUTLINE_ID,
    legacyOrder: [],
});

export const getPieceOutlinePreset = store.getPreset;
export const savePieceOutlinePreference = store.save;
export const loadPieceOutlinePreference = store.load;

/**
 * Apply a piece-outline mode to the document root.
 */
export function applyPieceOutline(id: string): void {
    const preset = getPieceOutlinePreset(id);
    document.documentElement.style.setProperty(
        CSS_CUSTOM_PROPERTY,
        preset.filter,
    );
}
