/**
 * Browser wrapper for the silhouette pipeline: load the puzzle image,
 * downscale onto an offscreen canvas, run the pure segmentation.
 *
 * Runs pre-generation (async), mirroring preloadTracedTabGenerator's
 * position in the new-game and share-link flows. On ANY failure —
 * tainted canvas (non-CORS share-link image), decode error, zero
 * regions — it degrades to [] so the generator falls back to a plain
 * sine lattice instead of failing the puzzle.
 */
import type { Size } from '../../model/types.js';
import { segmentImage, silhouetteParamsFromConfig } from './segment-image.js';
import type { SilhouetteOutline } from './types.js';

/** Working-raster width; height follows the frame aspect. */
const SEGMENTATION_RASTER_WIDTH = 256;

export async function computeSilhouetteOutlines(
    imageUrl: string,
    frame: Size,
    baseCutConfig: Record<string, unknown> | undefined,
): Promise<SilhouetteOutline[]> {
    try {
        const img = await loadImage(imageUrl);
        const width = Math.min(SEGMENTATION_RASTER_WIDTH, Math.max(2, Math.round(frame.width)));
        const height = Math.max(2, Math.round(width * (frame.height / frame.width)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return [];
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height); // throws if tainted
        const params = silhouetteParamsFromConfig(baseCutConfig);
        return segmentImage(
            { width, height, data: imageData.data }, frame, params,
        );
    } catch (err) {
        console.warn('[silhouette] segmentation failed; using plain lattice', err);
        return [];
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`image load failed: ${url}`));
        img.src = url;
    });
}
