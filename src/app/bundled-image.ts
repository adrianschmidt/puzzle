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

import type { ImageAttribution, Size, Orientation } from '../model/types.js';

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

/** Portrait first-run / fallback asset (Barney Goodman, Unsplash q5BV6DBTpFM). */
export const BUNDLED_PORTRAIT_IMAGE_URL = 'first-puzzle-portrait.jpg';

export const BUNDLED_PORTRAIT_IMAGE_SIZE = { width: 1080, height: 1614 };

export const BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION: ImageAttribution = {
    photographerName: 'Barney Goodman',
    photographerUrl:
        'https://unsplash.com/@bgoodpic?utm_source=puzzle&utm_medium=referral',
    photoUrl:
        'https://unsplash.com/photos/q5BV6DBTpFM?utm_source=puzzle&utm_medium=referral',
};

/** A bundled first-run / fallback image: its URL, pixel size, and attribution. */
export interface BundledImage {
    url: string;
    size: Size;
    attribution: ImageAttribution;
}

/**
 * Choose the bundled first-run / fallback image for the puzzle orientation.
 * Landscape returns the original asset; portrait returns the portrait variant.
 */
export function pickBundledImage(orientation: Orientation): BundledImage {
    return orientation === 'portrait'
        ? {
            url: BUNDLED_PORTRAIT_IMAGE_URL,
            size: BUNDLED_PORTRAIT_IMAGE_SIZE,
            attribution: BUNDLED_PORTRAIT_IMAGE_ATTRIBUTION,
        }
        : {
            url: BUNDLED_IMAGE_URL,
            size: BUNDLED_IMAGE_SIZE,
            attribution: BUNDLED_IMAGE_ATTRIBUTION,
        };
}
