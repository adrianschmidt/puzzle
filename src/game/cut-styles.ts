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
export type CutStyle = 'classic' | 'fractal' | 'wavy' | 'composable';

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
 * Storage is id-keyed; declaration order is no longer load-bearing for
 * persistence. The legacy-integer migration (`LEGACY_ORDER` below)
 * relies on the original pre-migration order, captured separately.
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
