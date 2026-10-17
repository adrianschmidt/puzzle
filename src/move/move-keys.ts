export const MOVED_KEYS: readonly string[] = [
    'puzzle-game-state',
    'puzzle-progress',
    'puzzle-background-color',
    'puzzle-background-colour',
    'puzzle-piece-outline',
    'puzzle-piece-outline-color',
    'puzzle-merge-tolerance',
    'puzzle-rotation-enabled',
    'puzzle-marquee-contain',
    'puzzle-offset-drag',
    'puzzle-image-source',
    'puzzle-image-category',
    'puzzle-image-vibrant',
    'puzzle-size-preference',
    'puzzle-cut-style',
    'puzzle-composable-config',
    'puzzle-fractal-config',
    'puzzle-wavy-config',
    'puzzle-analytics-userid',
    'puzzle-game-analytics',
];

/**
 * - `puzzle-geometry-seed`: derived; the loader rebuilds it.
 * - `puzzle-offline-image-stash`: its images live in the old origin's Cache
 *   Storage, so the metadata would claim images the new site does not have.
 * - `puzzle-moved-to`: source-only.
 * - `share-link-rescue-attempt`: a per-tab sessionStorage guard.
 */
export const NOT_MOVED_KEYS: readonly string[] = [
    'puzzle-geometry-seed',
    'puzzle-offline-image-stash',
    'puzzle-moved-to',
    'share-link-rescue-attempt',
];
