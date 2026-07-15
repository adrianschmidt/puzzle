/**
 * Viewport-driven puzzle orientation.
 *
 * A new puzzle matches the shape of the screen it is created on. Orientation
 * is derived once, at generation time, and used to transpose the grid and
 * choose the image. It is never stored on its own — the resulting grid and
 * image size are what saves and share links encode, so replay reproduces the
 * orientation without re-reading the viewport.
 */

import type { Size, GridSize, Orientation } from '../model/types.js';

/**
 * Portrait when the viewport is taller than it is wide; otherwise landscape.
 * A square (or degenerate 0x0) viewport counts as landscape — the historical
 * default.
 */
export function orientationForViewport(size: Size): Orientation {
    return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * Normalize a grid to an orientation. Landscape puts the long axis horizontal
 * (cols >= rows); portrait puts it vertical (rows >= cols). Defined by
 * normalization rather than a blind swap, so it is correct and idempotent
 * regardless of the input grid's current orientation.
 */
export function orientGridSize(grid: GridSize, o: Orientation): GridSize {
    const long = Math.max(grid.cols, grid.rows);
    const short = Math.min(grid.cols, grid.rows);
    return o === 'portrait'
        ? { cols: short, rows: long }
        : { cols: long, rows: short };
}

/**
 * Pixel dimensions for a blank-canvas puzzle in the given orientation, so a
 * portrait screen gets a portrait blank canvas and a landscape screen a
 * landscape one. Mirrors {@link pickBundledImage} for the bundled source,
 * keeping all image sources symmetric on orientation.
 */
export function blankSizeForOrientation(o: Orientation): Size {
    return o === 'portrait'
        ? { width: 720, height: 1080 }
        : { width: 1080, height: 720 };
}
