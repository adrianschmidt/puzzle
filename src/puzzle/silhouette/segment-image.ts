/**
 * Pure silhouette segmentation pipeline: quantize → components →
 * select → contour → simplify → smooth → scale to frame space.
 *
 * Deterministic for a given raster. The canvas-touching wrapper lives
 * in compute-outlines.ts so this module stays Node-testable.
 */
import type { Size } from '../../model/types.js';
import { quantize } from './quantize.js';
import { findRegions } from './regions.js';
import { selectRegions } from './select.js';
import { traceContour, simplifyClosed, smoothClosed } from './contour.js';
import { DEFAULT_SILHOUETTE_PARAMS } from './types.js';
import type { Raster, SilhouetteOutline, SilhouetteParams } from './types.js';

export function segmentImage(
    raster: Raster,
    frame: Size,
    params: SilhouetteParams,
): SilhouetteOutline[] {
    const { labels, palette } = quantize(raster, params.colorLevels);
    const { regions, componentMap } = findRegions(
        raster.width, raster.height, labels, palette,
    );
    const picked = selectRegions(regions, raster.width * raster.height, params);

    const scaleX = frame.width / raster.width;
    const scaleY = frame.height / raster.height;
    // Simplify in raster space: convert the frame-px tolerance down.
    const rasterTolerance = params.simplifyTolerancePx / Math.max(scaleX, scaleY);

    const outlines: SilhouetteOutline[] = [];
    for (const region of picked) {
        const contour = traceContour(
            raster.width, raster.height, componentMap, region.id,
        );
        if (contour.length < 4) continue; // too small to be a real outline
        const simplified = simplifyClosed(contour, rasterTolerance);
        if (simplified.length < 3) continue;
        const polygon = simplified.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        const path = smoothClosed(polygon, params.smoothing);
        outlines.push({
            path,
            polygon,
            area: region.area * scaleX * scaleY,
        });
    }
    return outlines;
}

/**
 * Read SilhouetteParams from an opaque bgc config record (compact
 * share-link keys), clamping every field to its safe range. The
 * simplify-tolerance floor (2px) is the curve-count budget: a crafted
 * st=0.001 would otherwise feed thousands of Bézier segments into the
 * O(n²) DCEL intersection pass.
 */
export function silhouetteParamsFromConfig(
    config: Record<string, unknown> | undefined,
): SilhouetteParams {
    const d = DEFAULT_SILHOUETTE_PARAMS;
    const num = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const clamp = (v: number, lo: number, hi: number): number =>
        Math.min(hi, Math.max(lo, v));
    return {
        colorLevels: clamp(Math.round(num(config?.cl, d.colorLevels)), 2, 32),
        maxRegions: clamp(Math.round(num(config?.mr, d.maxRegions)), 0, 20),
        minRegionFrac: clamp(num(config?.mnf, d.minRegionFrac), 0, 1),
        maxRegionFrac: clamp(num(config?.mxf, d.maxRegionFrac), 0, 1),
        allowAdjacent: config?.aa === true,
        simplifyTolerancePx: clamp(num(config?.st, d.simplifyTolerancePx), 2, 64),
        smoothing: clamp(num(config?.sm, d.smoothing), 0, 1),
    };
}
