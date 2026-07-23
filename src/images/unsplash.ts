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
        /** Small (400px) URL — used for picker thumbnails. */
        small: string;
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
    /** Links for the photo page (attribution) and download reporting. */
    links: {
        html: string;
        download_location: string;
    };
    /** Accessibility description; null when the photographer set none. */
    alt_description?: string | null;
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
    /** Small (400px) URL for thumbnail display. */
    thumbUrl: string;
    /** Unsplash download-reporting endpoint for this photo. */
    downloadLocation: string;
    /** Alt text for the photo, when Unsplash provides one. */
    description?: string;
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
    count?: number,
): string {
    const params = new URLSearchParams({
        orientation,
        client_id: accessKey,
    });

    if (query) {
        params.set('query', query);
    }

    if (count !== undefined) {
        params.set('count', String(count));
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
        thumbUrl: data.urls.small,
        downloadLocation: data.links.download_location,
        description: typeof data.alt_description === 'string' && data.alt_description.length > 0
            ? data.alt_description
            : undefined,
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
        hasString(data, 'urls', 'small') &&
        hasNumber(data, 'width') &&
        hasNumber(data, 'height') &&
        hasString(data, 'user', 'name') &&
        hasString(data, 'user', 'links', 'html') &&
        hasString(data, 'links', 'html') &&
        hasString(data, 'links', 'download_location')
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

/**
 * Fetch several random photos in a single API request.
 *
 * Uses `/photos/random?count=N`, which returns an array and costs one
 * request against the (per-application) rate limit regardless of count.
 *
 * @returns The parsed results, or `undefined` if the fetch fails.
 * @throws {Error} If the response body is not an array of photos.
 */
export async function fetchRandomImages(
    accessKey: string,
    count: number,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult[] | undefined> {
    const url = buildRandomPhotoUrl(accessKey, query, orientation, count);

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Unsplash API error: ${response.status} ${response.statusText}`,
        );

        return undefined;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
        throw new Error('Invalid Unsplash API response');
    }

    return data.map(parseUnsplashResponse);
}

/**
 * Report a photo as used, per the Unsplash API guidelines: apps must hit
 * the photo's `download_location` when the photo is actually used (here:
 * when a puzzle starts with it), not when it is merely displayed.
 *
 * Fire-and-forget semantics — failures are logged, never thrown, and the
 * response body is irrelevant.
 */
export async function triggerPhotoDownload(
    downloadLocation: string,
    accessKey: string,
    fetchFn: typeof fetch = fetch,
): Promise<void> {
    const url = new URL(downloadLocation);
    url.searchParams.set('client_id', accessKey);

    const response = await fetchFn(url.toString());

    if (!response.ok) {
        diagnostics.warn(
            `Unsplash download trigger failed: ${response.status} ${response.statusText}`,
        );
    }
}
