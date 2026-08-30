import { track } from '../analytics/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import { downloadOfflineImages, OFFLINE_STASH_COUNT } from '../images/offline-stash.js';
import type { Orientation } from '../model/types.js';

export async function downloadOfflineImagesForCategory(
    proxyBaseUrl: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    onProgress?: (done: number, total: number) => void,
): Promise<number> {
    const category = findImageCategory(imageCategory);
    const query = buildImageQuery(category.query, vibrant);
    const { saved, reason } = await downloadOfflineImages({
        proxyBaseUrl,
        query,
        orientation,
        onProgress,
    });
    track('offline-images-saved', {
        requested: OFFLINE_STASH_COUNT,
        saved,
        reason,
        imageCategory,
        orientation,
        vibrant,
    });
    return saved;
}
