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
