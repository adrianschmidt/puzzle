import { createIdPreferenceStore } from '../ui/preference-store.js';

export type CutStyle = 'classic' | 'fractal' | 'wavy' | 'triangles' | 'composable';

export interface CutStyleOption {
    id: CutStyle;
    label: string;
    description: string;
    /**
     * Piece rotation when the player enables rotation for a new game. Fractal
     * uses 90° steps; the rest rotate freely (quarter-turns don't match their
     * irregular shapes).
     */
    rotation: 'quarter-turn' | 'free';
    /**
     * Whether a new game of this style cuts with hand-traced tabs, which live in
     * a lazily-imported chunk fetched before generation. `'configurable'` = the
     * tab generator is a per-game choice, not a style property; see
     * {@link cutStyleNeedsTracedTabs}.
     */
    tracedTabs: 'always' | 'never' | 'configurable';
}

/**
 * Storage is id-keyed; declaration order no longer matters for persistence.
 * The legacy-integer migration relies on the pre-migration order, captured
 * separately in `LEGACY_ORDER`.
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
 * Pre-migration storage order — DO NOT reorder. Removable once enough users
 * have loaded the migrated build.
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
 * Whether Composable is selectable in the new-game dialog: true on `npm run dev`
 * (`import.meta.env.DEV`) and the PR-preview deploy (`/puzzle/dev/`), false on
 * production. Computed per call, not cached, so tests can stub the env.
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
 * Reads each style's `rotation` from `CUT_STYLE_OPTIONS`, so a new style must
 * declare its rotation to compile. Only new-game creation uses this; saves and
 * share links carry their own rotationMode, so older quarter-turn puzzles keep
 * loading unchanged.
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
 * traced-tab chunk preloaded. Reads `tracedTabs` from `CUT_STYLE_OPTIONS`, so a
 * new style must declare it to compile; missing a caller fails at generation
 * time with the registry stub's "not loaded" throw.
 *
 * `tabGenerator` is the per-game selection for a `'configurable'` style
 * (Composable's picker / a share payload's `cf.tg`); ignored otherwise. Plain
 * `string` because both call sites hold a loosely-typed id.
 *
 * Uses a raw `.find`, not the sibling {@link getCutStyleOption}: that reader
 * falls back to classic (so the picker always renders), but here that would
 * fetch the chunk for a nonexistent style — so an unrecognized id returns
 * `false` and is left to fail at the strategy lookup in `createNewGame`.
 *
 * New games only; saves/share links carry their own config, so a pre-upgrade
 * Classic or legacy-tab Wavy link needs no chunk despite `'always'` here.
 */
export function cutStyleNeedsTracedTabs(cutStyleId: string, tabGenerator?: string): boolean {
    const option = CUT_STYLE_OPTIONS.find((o) => o.id === cutStyleId);
    if (!option) return false;
    if (option.tracedTabs === 'configurable') return tabGenerator === 'traced';
    return option.tracedTabs === 'always';
}
