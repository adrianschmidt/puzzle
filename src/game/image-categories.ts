/**
 * Image category options and preference persistence.
 *
 * Defines available picture type categories for Unsplash image fetching.
 * Each category maps to a search query passed to the Unsplash API.
 */

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

/**
 * Save the preferred image category id to localStorage.
 */
export function saveImageCategoryPreference(id: string): void {
    localStorage.setItem(IMAGE_CATEGORY_PREFERENCE_KEY, id);
}

/**
 * Load the preferred image category id from localStorage.
 * Returns `'any'` if no preference is saved or the value is invalid.
 */
export function loadImageCategoryPreference(): string {
    try {
        const raw = localStorage.getItem(IMAGE_CATEGORY_PREFERENCE_KEY);
        if (raw === null) {
            return 'any';
        }

        // Validate that the saved value is a known category
        const found = IMAGE_CATEGORY_OPTIONS.find((opt) => opt.id === raw);

        return found ? raw : 'any';
    } catch {
        return 'any';
    }
}
