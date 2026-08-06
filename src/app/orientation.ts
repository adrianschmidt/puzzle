/**
 * Orientation is derived once, at generation time, and never stored on its
 * own — the resulting grid and image size are what saves and share links
 * encode, so replay reproduces the orientation without re-reading the
 * viewport.
 */

import type { Size, GridSize, Orientation } from '../model/types.js';

/**
 * A square (or degenerate 0x0) viewport counts as landscape — the historical
 * default.
 */
export function orientationForViewport(size: Size): Orientation {
    return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * Defined by normalization rather than a blind swap, so it is correct and
 * idempotent regardless of the input grid's current orientation.
 */
export function orientGridSize(grid: GridSize, o: Orientation): GridSize {
    const long = Math.max(grid.cols, grid.rows);
    const short = Math.min(grid.cols, grid.rows);
    return o === 'portrait'
        ? { cols: short, rows: long }
        : { cols: long, rows: short };
}

/**
 * Mirrors {@link pickBundledImage} for the bundled source, keeping all
 * image sources symmetric on orientation.
 */
export function blankSizeForOrientation(o: Orientation): Size {
    return o === 'portrait'
        ? { width: 720, height: 1080 }
        : { width: 1080, height: 720 };
}
