/**
 * Fetch the candidate photos shown in the new-game dialog's image picker
 * and map them into the picker's shape. Returns `null` when the fetch
 * fails or yields nothing — the picker shows its inline error state and
 * the player can retry via the refresh button, so failures here are
 * logged but not tracked as analytics events.
 */

import { diagnostics } from '../diagnostics.js';
import { fetchRandomImages } from '../images/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import { toDisplayImage } from './unsplash-display-image.js';
import type { Orientation } from '../model/types.js';
import { CANDIDATE_COUNT, type CandidateImage } from '../ui/image-picker.js';

/**
 * How many candidates one picker fetch requests (a single API call) — one per
 * grid tile, so the request count is tied to the picker's tile count.
 */
export const CANDIDATE_IMAGE_COUNT = CANDIDATE_COUNT;

export async function fetchCandidateImages(
    accessKey: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    fetchFn: typeof fetch = fetch,
): Promise<CandidateImage[] | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const results = await fetchRandomImages(
            accessKey,
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
