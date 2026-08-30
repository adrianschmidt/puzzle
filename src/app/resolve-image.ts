import { diagnostics } from '../diagnostics.js';
import { track, sanitizeErrorReason } from '../analytics/index.js';
import { fetchRandomImage, toDisplayImage, type DisplayImage } from '../images/index.js';
import { pickStashImage } from '../images/offline-stash.js';
import { GenerationCanceledError } from '../game/index.js';
import { findImageCategory, buildImageQuery } from '../game/image-categories.js';
import type { Orientation } from '../model/types.js';

export type ResolvedImage = DisplayImage;

async function resolveFromStash(
    cause: 'fetch-failed' | 'pool-miss',
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
): Promise<ResolvedImage | null> {
    const image = await pickStashImage(orientation);
    track('image-stash-fallback', {
        imageCategory,
        orientation,
        vibrant,
        hit: image !== null,
        cause,
    });
    return image;
}

export async function resolveUnsplashImage(
    proxyBaseUrl: string,
    imageCategory: string,
    vibrant: boolean,
    orientation: Orientation,
    signal?: AbortSignal,
): Promise<ResolvedImage | null> {
    try {
        const category = findImageCategory(imageCategory);
        const query = buildImageQuery(category.query, vibrant);
        const result = await fetchRandomImage(proxyBaseUrl, fetch, query, orientation, signal);

        if (!result || result === 'blocked') {
            const { resolveFromPool } = await import('../images/backup-pool.js');
            const poolImage = resolveFromPool(category.id, vibrant, orientation);
            track('image-pool-fallback', {
                imageCategory,
                orientation,
                vibrant,
                hit: poolImage !== null,
                cause: result === 'blocked' ? 'blocked' : 'http-error',
            });
            if (poolImage) return poolImage;
            return await resolveFromStash('pool-miss', imageCategory, vibrant, orientation);
        }

        return toDisplayImage(result);
    } catch (error) {
        // A canceled start aborts the fetch; surface it as the same cancellation
        // the generation phase throws so `startNewGame` tears the overlay down,
        // and don't file it as a fetch failure.
        if (signal?.aborted) throw new GenerationCanceledError();
        diagnostics.warn('Failed to fetch Unsplash image, using fallback:', error);
        track('image-fetch-failed', {
            reason: sanitizeErrorReason(error),
            orientation,
            imageCategory,
        });
        return await resolveFromStash('fetch-failed', imageCategory, vibrant, orientation);
    }
}
