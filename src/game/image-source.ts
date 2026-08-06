/**
 * The "image source" is the provider/strategy used to obtain the
 * puzzle image (e.g. `'unsplash'`, `'blank'`), distinct from the image
 * *category* (the Unsplash search query) in `image-categories.ts`.
 */

import { createStringPreference } from '../ui/preference-store.js';

const IMAGE_SOURCE_PREFERENCE_KEY = 'puzzle-image-source';

const store = createStringPreference({ key: IMAGE_SOURCE_PREFERENCE_KEY });

export const saveImageSourcePreference = store.save;

export const loadImageSourcePreference = store.load;

/**
 * Whether any image-source preference is stored — used with the
 * category check to detect a first-run visitor.
 */
export const imageSourcePreferenceExists = store.exists;
