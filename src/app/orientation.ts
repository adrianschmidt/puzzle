/**
 * Orientation is derived once at generation and never stored; the grid and
 * image size that saves/share links encode reproduce it on replay.
 */

import type { Size, GridSize, Orientation } from '../model/types.js';

/** A square (or 0x0) viewport counts as landscape (historical default). */
export function orientationForViewport(size: Size): Orientation {
    return size.height > size.width ? 'portrait' : 'landscape';
}

/** Normalization, not a blind swap, so it's idempotent regardless of the input's orientation. */
export function orientGridSize(grid: GridSize, o: Orientation): GridSize {
    const long = Math.max(grid.cols, grid.rows);
    const short = Math.min(grid.cols, grid.rows);
    return o === 'portrait'
        ? { cols: short, rows: long }
        : { cols: long, rows: short };
}

/** Mirrors {@link pickBundledImage}, keeping image sources symmetric on orientation. */
export function blankSizeForOrientation(o: Orientation): Size {
    return o === 'portrait'
        ? { width: 720, height: 1080 }
        : { width: 1080, height: 720 };
}
