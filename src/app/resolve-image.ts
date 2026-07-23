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
import { toDisplayImage, type DisplayImage } from './unsplash-display-image.js';
import type { Orientation } from '../model/types.js';

export type ResolvedImage = DisplayImage;

export async function resolveUnsplashImage(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedImage | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const result = await fetchRandomImage(accessKey, fetchFn, query, orientation);

        if (!result) {
            return null;
        }

        return toDisplayImage(result);
    } catch (error) {
        diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
        track('image-fetch-failed', {
            reason: sanitizeErrorReason(error),
            orientation,
            imageCategory,
        });
        return null;
    }
}
