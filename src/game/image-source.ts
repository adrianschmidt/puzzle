/**
 * Image source preference persistence.
 *
 * The "image source" is the provider/strategy used to obtain the
 * puzzle image (e.g. `'unsplash'`, `'blank'`). It is distinct from
 * the image *category* (the Unsplash search query) defined in
 * `image-categories.ts`.
 */

import { createStringPreference } from '../ui/preference-store.js';

/** localStorage key for the saved image source preference. */
const IMAGE_SOURCE_PREFERENCE_KEY = 'puzzle-image-source';

const store = createStringPreference({ key: IMAGE_SOURCE_PREFERENCE_KEY });

/**
 * Save the preferred image source to localStorage.
 */
export const saveImageSourcePreference = store.save;

/**
 * Load the preferred image source from localStorage.
 * Returns `undefined` if no preference is saved.
 */
export const loadImageSourcePreference = store.load;
