import { BUNDLED_IMAGE_URL } from './bundled-image.js';

/**
 * Heuristically classify a puzzle image URL into one of the sources we
 * care about for analytics. Used when the puzzle origin (a share
 * payload, or a resumed save) only carries the URL — not the choice
 * that produced it.
 *
 * `'bundled'` is the shipped image (first-run puzzles and
 * Unsplash-failure fallbacks — the fresh-game path distinguishes the
 * two itself); `'fallback'` covers the legacy `puzzle-image.jpg` from
 * old saves/links plus anything unrecognized.
 */
export function classifyImageSource(
    imageUrl: string,
): 'unsplash' | 'blank' | 'bundled' | 'fallback' {
    if (imageUrl.startsWith('data:')) {
        return 'blank';
    }
    if (imageUrl === BUNDLED_IMAGE_URL) {
        return 'bundled';
    }
    try {
        const host = new URL(imageUrl, window.location.href).host;
        if (host === 'images.unsplash.com') {
            return 'unsplash';
        }
    } catch {
        // Fall through to 'fallback' on malformed URLs.
    }
    return 'fallback';
}

/**
 * Resolve the analytics image-source label for a freshly-started game.
 *
 * A first-run start reuses the bundled image URL, so
 * {@link classifyImageSource} alone can't tell it from an
 * Unsplash-fetch-failure fallback (both land on the bundled URL). The
 * caller's `'first-run'` sentinel is the only signal, so honor it here;
 * otherwise classify by URL.
 */
export function resolveNewGameImageSource(
    imageSource: string | undefined,
    imageUrl: string,
): 'first-run' | ReturnType<typeof classifyImageSource> {
    return imageSource === 'first-run'
        ? 'first-run'
        : classifyImageSource(imageUrl);
}
