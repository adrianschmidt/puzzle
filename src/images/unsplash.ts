/**
 * Unsplash API client for fetching random landscape photos.
 *
 * Uses the Unsplash API free tier. The access key is provided via
 * `VITE_UNSPLASH_ACCESS_KEY` environment variable at build time.
 *
 * @see https://unsplash.com/documentation#get-a-random-photo
 */

/** The API endpoint for fetching a random photo. */
export const UNSPLASH_RANDOM_URL = 'https://api.unsplash.com/photos/random';

/** Minimum image dimension to ensure quality. */
export const MIN_IMAGE_DIMENSION = 800;

/**
 * Relevant fields from the Unsplash random photo response.
 * Only the fields we actually use — the full API response is much larger.
 */
export interface UnsplashPhoto {
    /** Raw image URLs at various sizes. */
    urls: {
        /** Processed image URL with configurable dimensions. */
        regular: string;
        /** Full-size image URL. */
        full: string;
    };
    /** Original image dimensions. */
    width: number;
    /** Original image dimensions. */
    height: number;
    /** Photographer attribution. */
    user: {
        name: string;
        links: {
            html: string;
        };
    };
    /** Links for the photo page (for attribution). */
    links: {
        html: string;
    };
}

/**
 * Result of a successful random image fetch.
 */
export interface UnsplashImageResult {
    /** URL to use for the puzzle image. */
    imageUrl: string;
    /** Original image width in pixels. */
    width: number;
    /** Original image height in pixels. */
    height: number;
    /** Photographer name for attribution. */
    photographerName: string;
    /** Link to photographer's Unsplash profile. */
    photographerUrl: string;
    /** Link to the photo on Unsplash. */
    photoUrl: string;
}

/**
 * Build the URL for fetching a random landscape photo from Unsplash.
 *
 * Filters for landscape orientation to match the puzzle grid aspect ratio.
 */
export function buildRandomPhotoUrl(accessKey: string): string {
    const params = new URLSearchParams({
        orientation: 'landscape',
        client_id: accessKey,
    });

    return `${UNSPLASH_RANDOM_URL}?${params.toString()}`;
}

/**
 * Parse an Unsplash API response into our result type.
 *
 * Validates that the response has the expected shape and the image
 * is large enough for a good puzzle experience.
 *
 * @throws {Error} If the response shape is invalid.
 */
export function parseUnsplashResponse(data: unknown): UnsplashImageResult {
    if (!isUnsplashPhoto(data)) {
        throw new Error('Invalid Unsplash API response');
    }

    // Use the "regular" URL (1080px wide) — good balance of quality and load time
    const imageUrl = data.urls.regular;

    return {
        imageUrl,
        width: data.width,
        height: data.height,
        photographerName: data.user.name,
        photographerUrl: `${data.user.links.html}?utm_source=puzzle&utm_medium=referral`,
        photoUrl: `${data.links.html}?utm_source=puzzle&utm_medium=referral`,
    };
}

/**
 * Type guard to validate an Unsplash photo response.
 */
function isUnsplashPhoto(data: unknown): data is UnsplashPhoto {
    if (typeof data !== 'object' || data === null) {
        return false;
    }

    const obj = data as Record<string, unknown>;

    // Check urls
    if (typeof obj.urls !== 'object' || obj.urls === null) {
        return false;
    }

    const urls = obj.urls as Record<string, unknown>;

    if (typeof urls.regular !== 'string' || typeof urls.full !== 'string') {
        return false;
    }

    // Check dimensions
    if (typeof obj.width !== 'number' || typeof obj.height !== 'number') {
        return false;
    }

    // Check user
    if (typeof obj.user !== 'object' || obj.user === null) {
        return false;
    }

    const user = obj.user as Record<string, unknown>;

    if (typeof user.name !== 'string') {
        return false;
    }

    if (typeof user.links !== 'object' || user.links === null) {
        return false;
    }

    const userLinks = user.links as Record<string, unknown>;

    if (typeof userLinks.html !== 'string') {
        return false;
    }

    // Check links
    if (typeof obj.links !== 'object' || obj.links === null) {
        return false;
    }

    const links = obj.links as Record<string, unknown>;

    if (typeof links.html !== 'string') {
        return false;
    }

    return true;
}

/**
 * Get the Unsplash access key from the build-time environment variable.
 *
 * Returns `undefined` if the key is not configured.
 */
export function getUnsplashAccessKey(): string | undefined {
    const key = import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined;

    if (!key || key.trim().length === 0) {
        return undefined;
    }

    return key.trim();
}

/**
 * Fetch a random landscape photo from Unsplash.
 *
 * @param accessKey - Unsplash API access key
 * @param fetchFn - Fetch implementation (injectable for testing)
 * @returns The image result, or `undefined` if the fetch fails
 */
export async function fetchRandomImage(
    accessKey: string,
    fetchFn: typeof fetch = fetch,
): Promise<UnsplashImageResult | undefined> {
    const url = buildRandomPhotoUrl(accessKey);

    const response = await fetchFn(url);

    if (!response.ok) {
        console.warn(
            `Unsplash API error: ${response.status} ${response.statusText}`,
        );

        return undefined;
    }

    const data: unknown = await response.json();

    return parseUnsplashResponse(data);
}
