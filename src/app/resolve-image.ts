/**
 * Fetch a random Unsplash image for a new puzzle and map it into the shape
 * the game needs. Returns `null` when no image is available — either Unsplash
 * returned no usable photo (a handled, untracked outcome) or the fetch threw
 * (reported as `image-fetch-failed`). Either way the caller falls back to its
 * default image. Extracted from `main.ts` so the failure reporting is testable.
 */

import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { fetchRandomImage } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';

export interface ResolvedImage {
    imageUrl: string;
    imageSize: { width: number; height: number };
    attribution: {
        photographerName: string;
        photographerUrl: string;
        photoUrl: string;
    };
}

export async function resolveUnsplashImage(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedImage | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const result = await fetchRandomImage(accessKey, fetchFn, query);

        if (!result) {
            return null;
        }

        // The Unsplash "regular" URL delivers images scaled to 1080px wide.
        // Compute the height from the original aspect ratio so the puzzle
        // generator produces correctly proportioned pieces.
        const aspectRatio = result.height / result.width;
        const displayWidth = 1080;
        return {
            imageUrl: result.imageUrl,
            imageSize: {
                width: displayWidth,
                height: Math.round(displayWidth * aspectRatio),
            },
            attribution: {
                photographerName: result.photographerName,
                photographerUrl: result.photographerUrl,
                photoUrl: result.photoUrl,
            },
        };
    } catch (error) {
        diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
        track('image-fetch-failed', { reason: sanitizeErrorReason(error) });
        return null;
    }
}
