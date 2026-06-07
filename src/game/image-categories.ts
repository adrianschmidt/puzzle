/**
 * Image category options and preference persistence.
 *
 * Defines available picture type categories for Unsplash image fetching.
 * Each category maps to a search query passed to the Unsplash API.
 */

import {
    createBooleanPreference,
    createStringPreference,
} from '../ui/preference-store.js';

/**
 * Identifier for an image category.
 */
export type ImageCategoryId =
    | 'any'
    | 'nature'
    | 'animals'
    | 'architecture'
    | 'space'
    | 'abstract'
    | 'food'
    | 'travel';

/**
 * A selectable image category option.
 */
export interface ImageCategoryOption {
    /** Machine identifier. */
    id: ImageCategoryId;
    /** Display label. */
    label: string;
    /** Search query string(s) for the Unsplash API. Undefined means no query (random). */
    query: string | undefined;
    /** Short description of the category. */
    description: string;
}

/**
 * Available image category options.
 *
 * The `any` option preserves current behavior (no query parameter).
 * Other options pass a search query to the Unsplash `/photos/random` endpoint.
 */
export const IMAGE_CATEGORY_OPTIONS: readonly ImageCategoryOption[] = [
    {
        id: 'any',
        label: 'Any',
        query: undefined,
        description: 'Random photo',
    },
    {
        id: 'nature',
        label: 'Nature',
        query: 'nature landscape',
        description: 'Nature & landscapes',
    },
    {
        id: 'animals',
        label: 'Animals',
        query: 'animals wildlife',
        description: 'Animals & wildlife',
    },
    {
        id: 'architecture',
        label: 'Architecture',
        query: 'architecture building',
        description: 'Buildings & architecture',
    },
    {
        id: 'space',
        label: 'Space',
        query: 'space nebula galaxy',
        description: 'Space & astronomy',
    },
    {
        id: 'abstract',
        label: 'Abstract',
        query: 'abstract colorful pattern',
        description: 'Abstract & patterns',
    },
    {
        id: 'food',
        label: 'Food',
        query: 'food cooking',
        description: 'Food & cooking',
    },
    {
        id: 'travel',
        label: 'Travel',
        query: 'travel adventure',
        description: 'Travel & adventure',
    },
] as const;

/** localStorage key for the saved image category preference. */
export const IMAGE_CATEGORY_PREFERENCE_KEY = 'puzzle-image-category';

/** localStorage key for the saved "vibrant images" toggle. */
export const VIBRANT_PREFERENCE_KEY = 'puzzle-image-vibrant';

/**
 * Keywords appended to the Unsplash query when the player wants
 * vibrant/colorful photos. Unsplash has no saturation/HDR filter,
 * so we bias the search via descriptive tags photographers use.
 */
export const VIBRANT_QUERY_TERMS = 'vibrant colorful';

/**
 * Compose the final Unsplash `query` string from a category's query
 * and the vibrant toggle. Returns `undefined` when no query should
 * be sent (any category with vibrant off).
 */
export function buildImageQuery(
    categoryQuery: string | undefined,
    vibrant: boolean,
): string | undefined {
    if (!vibrant) {
        return categoryQuery;
    }

    if (!categoryQuery) {
        return VIBRANT_QUERY_TERMS;
    }

    return `${categoryQuery} ${VIBRANT_QUERY_TERMS}`;
}

/**
 * Find an image category option by its id.
 * Returns the first option ('any') if not found.
 */
export function findImageCategory(
    id: string,
): ImageCategoryOption {
    const found = IMAGE_CATEGORY_OPTIONS.find((opt) => opt.id === id);

    return found ?? IMAGE_CATEGORY_OPTIONS[0];
}

const categoryStore = createStringPreference({
    key: IMAGE_CATEGORY_PREFERENCE_KEY,
    allowed: IMAGE_CATEGORY_OPTIONS.map((opt) => opt.id),
    defaultValue: 'any',
});

/**
 * Save the preferred image category id to localStorage.
 */
export const saveImageCategoryPreference = categoryStore.save;

/**
 * Load the preferred image category id from localStorage.
 * Returns `'any'` if no preference is saved or the value is invalid.
 */
export const loadImageCategoryPreference = categoryStore.load;

const vibrantStore = createBooleanPreference({
    key: VIBRANT_PREFERENCE_KEY,
    defaultValue: false,
});

/**
 * Save the "vibrant images" preference to localStorage.
 */
export const saveVibrantPreference = vibrantStore.save;

/**
 * Load the "vibrant images" preference from localStorage.
 * Returns `false` when nothing is saved or the stored value is invalid.
 */
export const loadVibrantPreference = vibrantStore.load;
