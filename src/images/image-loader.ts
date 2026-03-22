/**
 * Image loading utilities.
 *
 * Preloads images and extracts their dimensions.
 * Used to determine puzzle grid sizing for dynamically fetched images.
 */

import type { Size } from '../model/types.js';

/**
 * Load an image and return its natural dimensions.
 *
 * Creates an offscreen `<img>`, waits for it to load, then reads
 * `naturalWidth` and `naturalHeight`.
 *
 * @param url - Image URL to load
 * @returns The image's natural dimensions
 * @throws {Error} If the image fails to load
 */
export function loadImageDimensions(url: string): Promise<Size> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            resolve({
                width: img.naturalWidth,
                height: img.naturalHeight,
            });
        };

        img.onerror = () => {
            reject(new Error(`Failed to load image: ${url}`));
        };

        img.src = url;
    });
}
