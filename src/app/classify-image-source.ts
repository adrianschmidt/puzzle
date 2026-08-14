import { BUNDLED_IMAGE_URL, BUNDLED_PORTRAIT_IMAGE_URL } from './bundled-image.js';

/**
 * Classifies a puzzle image URL when only the URL survived (a share payload or
 * resumed save), not the choice behind it. `'bundled'` is the shipped image
 * (first-run and Unsplash-failure fallbacks, landscape or portrait);
 * `'fallback'` covers the legacy `puzzle-image.jpg` and anything unrecognized.
 */
export function classifyImageSource(
    imageUrl: string | null,
): 'unsplash' | 'blank' | 'bundled' | 'fallback' {
    if (imageUrl === null) {
        return 'blank';
    }
    if (imageUrl === BUNDLED_IMAGE_URL || imageUrl === BUNDLED_PORTRAIT_IMAGE_URL) {
        return 'bundled';
    }
    try {
        const host = new URL(imageUrl, window.location.href).host;
        if (host === 'images.unsplash.com') {
            return 'unsplash';
        }
    } catch {
        // Malformed URL: fall through to 'fallback'.
    }
    return 'fallback';
}

/**
 * A first-run start reuses the bundled URL, so {@link classifyImageSource}
 * can't tell it from an Unsplash-failure fallback. The caller's `'first-run'`
 * sentinel is the only signal; honor it, else classify by URL.
 */
export function resolveNewGameImageSource(
    imageSource: string | undefined,
    imageUrl: string | null,
): 'first-run' | ReturnType<typeof classifyImageSource> {
    return imageSource === 'first-run'
        ? 'first-run'
        : classifyImageSource(imageUrl);
}
