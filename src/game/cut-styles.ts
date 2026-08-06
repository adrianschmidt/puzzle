import { createIdPreferenceStore } from '../ui/preference-store.js';

export type CutStyle = 'classic' | 'fractal' | 'wavy' | 'triangles' | 'composable';

export interface CutStyleOption {
    id: CutStyle;
    label: string;
    description: string;
    /**
     * How pieces rotate when the player enables rotation for a new game.
     * Fractal uses 90° steps; the rest rotate freely because quarter-turns
     * don't match their irregular piece shapes.
     */
    rotation: 'quarter-turn' | 'free';
    /**
     * Whether a new game of this style cuts with hand-traced tabs, which
     * live in a lazily-imported chunk that has to be fetched before
     * generation runs.
     *
     * `'configurable'` covers the styles whose tab generator is a per-game
     * choice rather than a property of the style — see
     * {@link cutStyleNeedsTracedTabs}.
     */
    tracedTabs: 'always' | 'never' | 'configurable';
}

/**
 * Storage is id-keyed; declaration order is no longer load-bearing for
 * persistence. The legacy-integer migration (`LEGACY_ORDER` below)
 * relies on the original pre-migration order, captured separately.
 */
export const CUT_STYLE_OPTIONS: readonly CutStyleOption[] = [
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional jigsaw pieces',
        rotation: 'free',
        tracedTabs: 'always',
    },
    {
        id: 'fractal',
        label: 'Fractal',
        description: 'Organic circle-packing',
        rotation: 'quarter-turn',
        tracedTabs: 'never',
    },
    {
        id: 'wavy',
        label: 'Wavy',
        description: 'Like Classic, but each cut curves boldly',
        rotation: 'free',
        tracedTabs: 'always',
    },
    {
        id: 'triangles',
        label: 'Triangles',
        description: 'An irregular lattice of triangles',
        rotation: 'free',
        tracedTabs: 'always',
    },
    {
        id: 'composable',
        label: 'Composable',
        description: 'Experimental — customizable cuts',
        rotation: 'free',
        tracedTabs: 'configurable',
    },
] as const;

export const DEFAULT_CUT_STYLE_ID: CutStyle = 'classic';

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

export function getVisibleCutStyleOptions(): readonly CutStyleOption[] {
    if (isComposableVisible()) return CUT_STYLE_OPTIONS;
    return CUT_STYLE_OPTIONS.filter((o) => o.id !== 'composable');
}

/**
 * Reads each style's `rotation` capability from `CUT_STYLE_OPTIONS`, so a
 * new cut style must declare its rotation behavior to compile.
 *
 * Only new-game creation goes through this mapping. Saves and share links
 * carry their own rotationMode, so older quarter-turn Classic/Wavy/Composable
 * puzzles keep loading unchanged.
 */
export function rotationModeForNewGame(
    cutStyle: CutStyle,
    rotationEnabled: boolean,
): 'none' | 'quarter-turn' | 'free' {
    if (!rotationEnabled) return 'none';
    return getCutStyleOption(cutStyle).rotation;
}

/**
 * Whether starting a new game of `cutStyleId` needs the lazily-imported
 * traced-tab chunk preloaded.
 *
 * Reads each style's `tracedTabs` capability from `CUT_STYLE_OPTIONS`, so a
 * new cut style must declare whether it needs the chunk to compile — the same
 * forcing function `rotationModeForNewGame` gives rotation. Missing a caller
 * fails at generation time with the registry stub's "Traced tab library not
 * loaded" throw, which is why this lives next to the other per-style
 * declarations rather than being restated at each call site.
 *
 * `tabGenerator` is the per-game tab-generator selection for a
 * `tracedTabs: 'configurable'` style (Composable's picker value / a share
 * payload's `cf.tg`). Ignored for every other style.
 *
 * Takes a plain `string` because both call sites hold a loosely-typed id — a
 * stored preference and a dialog selection.
 *
 * Looks the id up with a raw `.find` rather than the file-sibling
 * {@link getCutStyleOption}, because the two want opposite things from an
 * unrecognized id. `getCutStyleOption` is a *preference* reader and falls back
 * to the classic option so the picker always has something to render; here a
 * fallback to classic would mean fetching the traced-tab chunk on behalf of a
 * style that doesn't exist. An unrecognized id needs no chunk, so it returns
 * `false` and leaves the id to fail where the real problem is: the strategy
 * lookup in `createNewGame`, where `getCutStyleStrategy` yields `undefined`
 * and the first call on it throws.
 *
 * This answers the question for *new games only*. Reproducing an existing save
 * or share link is a different question: those carry their own per-style
 * config, and a pre-upgrade Classic link or a legacy-tab Wavy link needs no
 * chunk even though the style declares `'always'` here.
 */
export function cutStyleNeedsTracedTabs(cutStyleId: string, tabGenerator?: string): boolean {
    const option = CUT_STYLE_OPTIONS.find((o) => o.id === cutStyleId);
    if (!option) return false;
    if (option.tracedTabs === 'configurable') return tabGenerator === 'traced';
    return option.tracedTabs === 'always';
}
