/**
 * The image bundled with the app (`public/first-puzzle.jpg`). It plays
 * two roles: the pre-determined image for a brand-new visitor's first
 * puzzle (chosen to contrast well with the default background), and
 * the fallback when the Unsplash fetch fails.
 *
 * The previous fallback asset `public/puzzle-image.jpg` must stay in
 * the deploy untouched: old saves and share links reference that URL
 * with 800×600 geometry.
 */

import type { ImageAttribution } from '../model/types.js';

/** Relative URL — resolves against the app origin, like all bundled assets. */
export const BUNDLED_IMAGE_URL = 'first-puzzle.jpg';

export const BUNDLED_IMAGE_SIZE = { width: 1080, height: 722 };

export const BUNDLED_IMAGE_ATTRIBUTION: ImageAttribution = {
    photographerName: 'Barney Goodman',
    photographerUrl:
        'https://unsplash.com/@bgoodpic?utm_source=puzzle&utm_medium=referral',
    photoUrl:
        'https://unsplash.com/photos/BS-bOYlt_Lg?utm_source=puzzle&utm_medium=referral',
};
