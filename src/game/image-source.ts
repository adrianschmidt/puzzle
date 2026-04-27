/**
 * Image source preference persistence.
 *
 * The "image source" is the provider/strategy used to obtain the
 * puzzle image (e.g. `'unsplash'`, `'blank'`). It is distinct from
 * the image *category* (the Unsplash search query) defined in
 * `image-categories.ts`.
 */

/** localStorage key for the saved image source preference. */
const IMAGE_SOURCE_PREFERENCE_KEY = 'puzzle-image-source';

/**
 * Save the preferred image source to localStorage.
 */
export function saveImageSourcePreference(source: string): void {
    localStorage.setItem(IMAGE_SOURCE_PREFERENCE_KEY, source);
}

/**
 * Load the preferred image source from localStorage.
 * Returns `undefined` if no preference is saved.
 */
export function loadImageSourcePreference(): string | undefined {
    try {
        const raw = localStorage.getItem(IMAGE_SOURCE_PREFERENCE_KEY);

        return raw ?? undefined;
    } catch {
        return undefined;
    }
}
