/**
 * White image at a given pixel size, as a data URL.
 *
 * The "blank" puzzle has no photo, but generation still needs an image of a
 * definite size: geometry depends on the image's dimensions, not its pixels.
 * Used by the fresh-game path (matching the puzzle's orientation) and by the
 * share-link path (regenerating the sentinel at the recorded dimensions).
 */

import type { Size } from '../model/types.js';

export function createBlankImageDataUrl(size: Size): string {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    return canvas.toDataURL('image/png');
}
