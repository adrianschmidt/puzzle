import type { Size } from '../model/types.js';

export function loadImageDimensions(url: string): Promise<Size> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.addEventListener('load', () => {
            resolve({
                width: img.naturalWidth,
                height: img.naturalHeight,
            });
        });

        img.addEventListener('error', () => {
            reject(new Error(`Failed to load image: ${url}`));
        });

        img.src = url;
    });
}
