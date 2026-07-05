/**
 * Shared types for the silhouette segmentation pipeline.
 *
 * Everything here is pure data. The pipeline runs OUTSIDE the seeded
 * generation path (pre-generation, async) and must be deterministic
 * for a given pixel buffer — no randomness anywhere in this module.
 */
import type { Point } from '../../model/types.js';

/** Segmentation tuning; every field maps to a dev slider. */
export interface SilhouetteParams {
    /** Median-cut palette size (2–32). */
    colorLevels: number;
    /** Maximum number of regions to trace (0–20). */
    maxRegions: number;
    /** Minimum region area as a fraction of the frame (0–1). */
    minRegionFrac: number;
    /** Maximum region area as a fraction of the frame (0–1). */
    maxRegionFrac: number;
    /** Allow tracing two adjacent regions (sliver risk; see spec). */
    allowAdjacent: boolean;
    /** Douglas-Peucker tolerance in frame px (hard floor: 2). */
    simplifyTolerancePx: number;
    /** Contour smoothing strength 0–1 (0 = polygon, 1 = full Catmull-Rom). */
    smoothing: number;
}

export const DEFAULT_SILHOUETTE_PARAMS: SilhouetteParams = {
    colorLevels: 8,
    maxRegions: 5,
    minRegionFrac: 0.01,
    maxRegionFrac: 0.25,
    allowAdjacent: false,
    simplifyTolerancePx: 4,
    smoothing: 0.8,
};

/** A traced region outline, in puzzle-frame coordinates. */
export interface SilhouetteOutline {
    /** Closed cubic-Bézier path: 3n+1 points, first === last. */
    path: Point[];
    /** Simplified polygon (pre-smoothing) for containment tests. */
    polygon: Point[];
    /** Region area in frame px² (scaled from the raster mask). */
    area: number;
}

/** RGBA pixel buffer with the same layout as ImageData (Node-testable). */
export interface Raster {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}
