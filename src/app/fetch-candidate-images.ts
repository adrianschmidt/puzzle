/**
 * Returns `null` when the fetch fails or yields nothing — the picker
 * shows its inline error state and the player can retry via the refresh
 * button. An error-status answer from the proxy is reported one layer
 * down as `image-fetch-http-error`; the thrown path caught here stays
 * untracked.
 */

import { diagnostics } from '../diagnostics.js';
import { fetchRandomImages } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import { CANDIDATE_COUNT, toDisplayImage, type CandidateImage } from './unsplash-display-image.js';
import type { Orientation } from '../model/types.js';

/**
 * How many candidates one picker fetch requests (a single API call) — one per
 * grid tile, so the request count is tied to the picker's tile count.
 */
export const CANDIDATE_IMAGE_COUNT = CANDIDATE_COUNT;

export async function fetchCandidateImages(
    proxyBaseUrl: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<CandidateImage[] | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const results = await fetchRandomImages(
            proxyBaseUrl,
            CANDIDATE_IMAGE_COUNT,
            fetchFn,
            query,
            orientation,
        );

        if (!results || results.length === 0) {
            return null;
        }

        return results.map((result) => {
            const candidate: CandidateImage = {
                ...toDisplayImage(result),
                thumbUrl: result.thumbUrl,
            };
            if (result.description !== undefined) {
                candidate.description = result.description;
            }
            return candidate;
        });
    } catch (error) {
        diagnostics.warn('Failed to fetch candidate images:', error);
        return null;
    }
}
