/**
 * A no-usable-photo result is reported one layer down as
 * `image-fetch-http-error`; only a thrown fetch is reported here, as
 * `image-fetch-failed`. Either way the caller falls back to its default image.
 */

import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { fetchRandomImage } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import { toDisplayImage, type DisplayImage } from './unsplash-display-image.js';
import type { Orientation } from '../model/types.js';

export type ResolvedImage = DisplayImage;

export async function resolveUnsplashImage(
    proxyBaseUrl: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedImage | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const result = await fetchRandomImage(proxyBaseUrl, fetchFn, query, orientation);

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
