/**
 * `--piece-edge-filter` on `documentElement` is read by `[data-group-id]`
 * and its state variants via `var(...)`.
 */

import { createIdPreferenceStore } from './preference-store.js';

export interface PieceOutlinePreset {
    /** Persisted in localStorage — must stay stable. */
    id: string;
    label: string;
    description: string;
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

export function applyPieceOutline(id: string): void {
    const preset = getPieceOutlinePreset(id);
    document.documentElement.style.setProperty(
        CSS_CUSTOM_PROPERTY,
        preset.filter,
    );
}
