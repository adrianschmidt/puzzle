/**
 * Unsplash API client for fetching random photos.
 *
 * Uses the Unsplash API free tier. The access key is provided via
 * `VITE_UNSPLASH_ACCESS_KEY` environment variable at build time.
 *
 * @see https://unsplash.com/documentation#get-a-random-photo
 */

import { diagnostics } from '../diagnostics.js';
import type { Orientation } from '../model/types.js';

/** The API endpoint for fetching a random photo. */
export const UNSPLASH_RANDOM_URL = 'https://api.unsplash.com/photos/random';

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
 * Build the URL for fetching a random photo from Unsplash.
 *
 * Filters for the requested orientation.
 */
export function buildRandomPhotoUrl(
    accessKey: string,
    query?: string,
    orientation: Orientation = 'landscape',
): string {
    const params = new URLSearchParams({
        orientation,
        client_id: accessKey,
    });

    if (query) {
        params.set('query', query);
    }

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

/** Walk a dotted-key path through an unknown value, returning the leaf or undefined. */
function getAtPath(data: unknown, path: readonly string[]): unknown {
    let current: unknown = data;

    for (const key of path) {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }

        current = (current as Record<string, unknown>)[key];
    }

    return current;
}

function hasString(data: unknown, ...path: string[]): boolean {
    return typeof getAtPath(data, path) === 'string';
}

function hasNumber(data: unknown, ...path: string[]): boolean {
    return typeof getAtPath(data, path) === 'number';
}

/**
 * Type guard to validate an Unsplash photo response.
 */
function isUnsplashPhoto(data: unknown): data is UnsplashPhoto {
    return (
        hasString(data, 'urls', 'regular') &&
        hasString(data, 'urls', 'full') &&
        hasNumber(data, 'width') &&
        hasNumber(data, 'height') &&
        hasString(data, 'user', 'name') &&
        hasString(data, 'user', 'links', 'html') &&
        hasString(data, 'links', 'html')
    );
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
 * Fetch a random photo from Unsplash.
 *
 * @param accessKey - Unsplash API access key
 * @param fetchFn - Fetch implementation (injectable for testing)
 * @returns The image result, or `undefined` if the fetch fails
 */
export async function fetchRandomImage(
    accessKey: string,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult | undefined> {
    const url = buildRandomPhotoUrl(accessKey, query, orientation);

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Unsplash API error: ${response.status} ${response.statusText}`,
        );

        return undefined;
    }

    const data: unknown = await response.json();

    return parseUnsplashResponse(data);
}
