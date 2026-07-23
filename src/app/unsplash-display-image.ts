/**
 * Shared Unsplash-result → display-model mapping used by both the single-image
 * resolver (`resolve-image.ts`) and the candidate-grid fetcher
 * (`fetch-candidate-images.ts`), so the 1080-scale math and attribution shape
 * stay in one place.
 *
 * The Unsplash "regular" URL delivers images scaled to 1080px wide; the height
 * is computed from the original aspect ratio so the puzzle generator produces
 * correctly proportioned pieces.
 */

import type { UnsplashImageResult } from '../images/index.js';

export interface DisplayImage {
    imageUrl: string;
    imageSize: { width: number; height: number };
    attribution: {
        photographerName: string;
        photographerUrl: string;
        photoUrl: string;
    };
    /** Unsplash download-reporting endpoint, triggered when the game starts. */
    downloadLocation: string;
}

/**
 * A candidate photo the player can pick in the new-game dialog's image picker.
 * A `DisplayImage` plus the small thumbnail hotlinked into the grid and an
 * optional alt text; `extends DisplayImage` keeps the superset relationship
 * compiler-enforced, so the two shapes can't silently drift.
 */
export interface CandidateImage extends DisplayImage {
    /** Small URL hotlinked as the grid thumbnail (Unsplash `small`). */
    thumbUrl: string;
    /** Alt text, when Unsplash provides one. */
    description?: string;
}

/** Number of candidate photos requested and displayed in the picker. */
export const CANDIDATE_COUNT = 4;

/** Width the Unsplash "regular" URL scales images to. */
const DISPLAY_WIDTH = 1080;

export function toDisplayImage(result: UnsplashImageResult): DisplayImage {
    const aspectRatio = result.height / result.width;
    return {
        imageUrl: result.imageUrl,
        imageSize: {
            width: DISPLAY_WIDTH,
            height: Math.round(DISPLAY_WIDTH * aspectRatio),
        },
        attribution: {
            photographerName: result.photographerName,
            photographerUrl: result.photographerUrl,
            photoUrl: result.photoUrl,
        },
        downloadLocation: result.downloadLocation,
    };
}
