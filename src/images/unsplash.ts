/**
 * Unsplash API client for fetching random photos.
 *
 * Calls go through our own proxy Worker (`src/worker/image-proxy.ts`) rather
 * than `api.unsplash.com` directly: this is a static site, so a build-time
 * API key would be inlined into the bundle and readable by every visitor
 * (#534). The Worker holds the key and adds it server-side.
 *
 * `VITE_IMAGE_PROXY_URL` names the Worker. It is a plain URL, not a secret,
 * so inlining it is fine — and its absence still means "no photo source",
 * the same gate the access key used to provide.
 *
 * @see https://unsplash.com/documentation#get-a-random-photo
 */

import { diagnostics } from '../diagnostics.js';
import type { Orientation } from '../model/types.js';

/** Proxy route that forwards to Unsplash's `/photos/random`. */
export const PROXY_RANDOM_PATH = '/random';

/** Proxy route that forwards a photo's `download_location`. */
export const PROXY_DOWNLOAD_PATH = '/download';

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
 * Build the proxy URL for fetching a random photo.
 *
 * Filters for the requested orientation. Carries no credential of any kind:
 * the Worker authenticates with an `Authorization` header it adds itself, and
 * strips any `client_id` a caller supplies. A key in this URL would mean the
 * key is back in the bundle, which is the whole point of routing through it.
 */
export function buildRandomPhotoUrl(
    proxyBaseUrl: string,
    query?: string,
    orientation: Orientation = 'landscape',
    count?: number,
): string {
    const params = new URLSearchParams({ orientation });

    if (query) {
        params.set('query', query);
    }

    if (count !== undefined) {
        params.set('count', String(count));
    }

    return `${proxyBaseUrl}${PROXY_RANDOM_PATH}?${params.toString()}`;
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
 * Get the image-proxy base URL from the build-time environment variable.
 *
 * Returns `undefined` if no proxy is configured, which callers treat as "no
 * photo source available" — the same gate the access key used to provide, so
 * an unconfigured build still degrades to no picker rather than a broken one.
 *
 * A trailing slash is stripped so callers can append a rooted path.
 */
export function getImageProxyBaseUrl(): string | undefined {
    const url = import.meta.env.VITE_IMAGE_PROXY_URL as string | undefined;

    if (!url || url.trim().length === 0) {
        return undefined;
    }

    return url.trim().replace(/\/+$/, '');
}

/**
 * Fetch a random photo from Unsplash.
 *
 * @param proxyBaseUrl - Base URL of the image-proxy Worker
 * @param fetchFn - Fetch implementation (injectable for testing)
 * @returns The image result, or `undefined` if the fetch fails
 */
export async function fetchRandomImage(
    proxyBaseUrl: string,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult | undefined> {
    const url = buildRandomPhotoUrl(proxyBaseUrl, query, orientation);

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Image proxy error: ${response.status} ${response.statusText}`,
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
    proxyBaseUrl: string,
    count: number,
    fetchFn: typeof fetch = fetch,
    query?: string,
    orientation: Orientation = 'landscape',
): Promise<UnsplashImageResult[] | undefined> {
    const url = buildRandomPhotoUrl(proxyBaseUrl, query, orientation, count);

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Image proxy error: ${response.status} ${response.statusText}`,
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
    proxyBaseUrl: string,
    fetchFn: typeof fetch = fetch,
): Promise<void> {
    // The Worker validates that this really is an Unsplash download location
    // before attaching the key, so it cannot be turned into an open relay.
    const url = `${proxyBaseUrl}${PROXY_DOWNLOAD_PATH}`
        + `?url=${encodeURIComponent(downloadLocation)}`;

    const response = await fetchFn(url);

    if (!response.ok) {
        diagnostics.warn(
            `Image proxy error on download trigger: ${response.status} ${response.statusText}`,
        );
    }
}
