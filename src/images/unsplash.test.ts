/**
 * Tests for the Unsplash API client.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    buildRandomPhotoUrl,
    parseUnsplashResponse,
    fetchRandomImage,
    fetchRandomImages,
    triggerPhotoDownload,
    getImageProxyBaseUrl,
    PROXY_RANDOM_PATH,
    PROXY_DOWNLOAD_PATH,
} from './unsplash.js';
import { resolveUpstream, RANDOM_PARAMS } from '../worker/image-proxy.js';

/** Stand-in for the deployed Worker's base URL. */
const PROXY = 'https://proxy.example';

/** A valid Unsplash API response for testing. */
function makeUnsplashResponse() {
    return {
        urls: {
            regular: 'https://images.unsplash.com/photo-abc?w=1080',
            full: 'https://images.unsplash.com/photo-abc',
            small: 'https://images.unsplash.com/photo-abc?w=400',
        },
        width: 4000,
        height: 2667,
        user: {
            name: 'Test Photographer',
            links: {
                html: 'https://unsplash.com/@testphotographer',
            },
        },
        links: {
            html: 'https://unsplash.com/photos/abc123',
            download_location: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        },
        alt_description: 'a mountain lake at dawn',
    };
}

describe('buildRandomPhotoUrl', () => {
    it('targets the proxy route with orientation=landscape', () => {
        const url = buildRandomPhotoUrl(PROXY);

        expect(url.startsWith(`${PROXY}${PROXY_RANDOM_PATH}?`)).toBe(true);
        expect(url).toContain('orientation=landscape');
    });

    it('never carries a client_id — the Worker authenticates by header', () => {
        // The reason this module exists in its current shape (#534). A key in
        // this URL means the key is back in the bundle.
        const url = buildRandomPhotoUrl(PROXY, 'nature', 'portrait', 4);

        expect(url).not.toContain('client_id');
    });

    it('goes nowhere near api.unsplash.com', () => {
        // The client must not reach Unsplash directly: an unproxied call is
        // an unauthenticated one, and would 401 rather than fail loudly here.
        const url = buildRandomPhotoUrl(PROXY, 'nature');

        expect(url).not.toContain('api.unsplash.com');
    });

    it('includes query parameter when provided', () => {
        const url = buildRandomPhotoUrl(PROXY, 'nature landscape');

        expect(url).toContain('query=nature+landscape');
        expect(url).toContain('orientation=landscape');
    });

    it('omits query parameter when undefined', () => {
        const url = buildRandomPhotoUrl(PROXY, undefined);

        expect(url).not.toContain('query=');
    });

    it('omits query parameter when empty string', () => {
        const url = buildRandomPhotoUrl(PROXY, '');

        expect(url).not.toContain('query=');
    });

    it('uses orientation=portrait when requested', () => {
        const url = buildRandomPhotoUrl(PROXY, undefined, 'portrait');

        expect(url).toContain('orientation=portrait');
    });

    it('uses orientation=landscape when requested', () => {
        const url = buildRandomPhotoUrl(PROXY, undefined, 'landscape');

        expect(url).toContain('orientation=landscape');
    });

    it('includes count when provided', () => {
        const url = buildRandomPhotoUrl(PROXY, undefined, 'landscape', 4);

        expect(url).toContain('count=4');
    });

    it('omits count when not provided', () => {
        const url = buildRandomPhotoUrl(PROXY);

        expect(url).not.toContain('count=');
    });
});

describe('parseUnsplashResponse', () => {
    it('extracts image URL from valid response', () => {
        const response = makeUnsplashResponse();
        const result = parseUnsplashResponse(response);

        expect(result.imageUrl).toBe(
            'https://images.unsplash.com/photo-abc?w=1080',
        );
    });

    it('extracts original image dimensions', () => {
        const response = makeUnsplashResponse();
        const result = parseUnsplashResponse(response);

        expect(result.width).toBe(4000);
        expect(result.height).toBe(2667);
    });

    it('extracts photographer name', () => {
        const response = makeUnsplashResponse();
        const result = parseUnsplashResponse(response);

        expect(result.photographerName).toBe('Test Photographer');
    });

    it('adds UTM parameters to photographer URL', () => {
        const response = makeUnsplashResponse();
        const result = parseUnsplashResponse(response);

        expect(result.photographerUrl).toBe(
            'https://unsplash.com/@testphotographer?utm_source=puzzle&utm_medium=referral',
        );
    });

    it('adds UTM parameters to photo URL', () => {
        const response = makeUnsplashResponse();
        const result = parseUnsplashResponse(response);

        expect(result.photoUrl).toBe(
            'https://unsplash.com/photos/abc123?utm_source=puzzle&utm_medium=referral',
        );
    });

    it('throws on null response', () => {
        expect(() => parseUnsplashResponse(null)).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('throws on non-object response', () => {
        expect(() => parseUnsplashResponse('string')).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('throws on response missing urls', () => {
        const response = { ...makeUnsplashResponse(), urls: undefined };

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('throws on response missing user', () => {
        const response = { ...makeUnsplashResponse(), user: undefined };

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('throws on response missing links', () => {
        const response = { ...makeUnsplashResponse(), links: undefined };

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('throws on response with non-number dimensions', () => {
        const response = { ...makeUnsplashResponse(), width: 'not-a-number' };

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });

    it('extracts thumb URL, download location and description', () => {
        const result = parseUnsplashResponse(makeUnsplashResponse());

        expect(result.thumbUrl).toBe('https://images.unsplash.com/photo-abc?w=400');
        expect(result.downloadLocation).toBe(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        );
        expect(result.description).toBe('a mountain lake at dawn');
    });

    it('omits description when alt_description is null', () => {
        const response = { ...makeUnsplashResponse(), alt_description: null };

        expect(parseUnsplashResponse(response).description).toBeUndefined();
    });

    it('throws on response missing download_location', () => {
        const response = makeUnsplashResponse();
        response.links = { html: response.links.html } as typeof response.links;

        expect(() => parseUnsplashResponse(response)).toThrow(
            'Invalid Unsplash API response',
        );
    });
});

describe('fetchRandomImage', () => {
    it('returns image result on successful fetch', async () => {
        const responseData = makeUnsplashResponse();
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(responseData),
        });

        const result = await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(result).toBeDefined();
        expect(result!.imageUrl).toBe(responseData.urls.regular);
        expect(result!.photographerName).toBe('Test Photographer');
    });

    it('calls the correct URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl.startsWith(`${PROXY}${PROXY_RANDOM_PATH}?`)).toBe(true);
        expect(calledUrl).toContain('orientation=landscape');
        expect(calledUrl).not.toContain('client_id');
    });

    it('returns undefined on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });

    it('returns undefined on rate limit (429)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        expect(result).toBeUndefined();
        warnSpy.mockRestore();
    });

    it('passes query parameter to the URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch, 'nature landscape');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('query=nature+landscape');
    });

    it('omits query parameter when not provided', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch);

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).not.toContain('query=');
    });

    it('propagates fetch exceptions', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Network error');
    });

    it('threads portrait orientation into the request URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage(PROXY, mockFetch as unknown as typeof fetch, 'city', 'portrait');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('orientation=portrait');
    });
});

describe('fetchRandomImages', () => {
    it('parses an array response into results', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([makeUnsplashResponse(), makeUnsplashResponse()]),
        });

        const results = await fetchRandomImages(PROXY, 2, mockFetch as unknown as typeof fetch);

        expect(results).toHaveLength(2);
        expect(results![0].imageUrl).toBe('https://images.unsplash.com/photo-abc?w=1080');
        expect(results![0].thumbUrl).toBe('https://images.unsplash.com/photo-abc?w=400');
    });

    it('requests the given count and orientation', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([makeUnsplashResponse()]),
        });

        await fetchRandomImages(PROXY, 4, mockFetch as unknown as typeof fetch, 'nature', 'portrait');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('count=4');
        expect(calledUrl).toContain('orientation=portrait');
        expect(calledUrl).toContain('query=nature');
    });

    it('returns undefined on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const results = await fetchRandomImages(PROXY, 4, mockFetch as unknown as typeof fetch);

        expect(results).toBeUndefined();
        warnSpy.mockRestore();
    });

    it('throws when the body is not an array', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await expect(
            fetchRandomImages(PROXY, 4, mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Invalid Unsplash API response');
    });
});

describe('triggerPhotoDownload', () => {
    it('hands the download location to the proxy, intact', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        const location = 'https://api.unsplash.com/photos/abc123/download?ixid=xyz';

        await triggerPhotoDownload(
            location,
            PROXY,
            mockFetch as unknown as typeof fetch,
        );

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
        expect(calledUrl.origin + calledUrl.pathname).toBe(
            `${PROXY}${PROXY_DOWNLOAD_PATH}`,
        );
        // Round-trips whole, ixid included — the Worker re-parses it, and a
        // mangled ixid would break Unsplash's download attribution silently.
        expect(calledUrl.searchParams.get('url')).toBe(location);
        expect(calledUrl.searchParams.get('client_id')).toBeNull();
    });

    it('warns but does not throw on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            triggerPhotoDownload('https://api.unsplash.com/x/download', PROXY, mockFetch as unknown as typeof fetch),
        ).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});

describe('getImageProxyBaseUrl', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns undefined when unset, which is the "no picker" gate', () => {
        vi.stubEnv('VITE_IMAGE_PROXY_URL', '');
        expect(getImageProxyBaseUrl()).toBeUndefined();
    });

    it('returns undefined for a whitespace-only value', () => {
        vi.stubEnv('VITE_IMAGE_PROXY_URL', '   ');
        expect(getImageProxyBaseUrl()).toBeUndefined();
    });

    it('strips a trailing slash so callers can append a rooted path', () => {
        // Callers concatenate `${base}/random`. A pasted URL keeps the slash a
        // dashboard shows, and `//random` misses the Worker's exact-path check
        // and 404s every photo request.
        vi.stubEnv('VITE_IMAGE_PROXY_URL', 'https://proxy.example/');
        expect(getImageProxyBaseUrl()).toBe('https://proxy.example');

        vi.stubEnv('VITE_IMAGE_PROXY_URL', 'https://proxy.example///');
        expect(getImageProxyBaseUrl()).toBe('https://proxy.example');
    });

    it('trims surrounding whitespace', () => {
        vi.stubEnv('VITE_IMAGE_PROXY_URL', '  https://proxy.example  ');
        expect(getImageProxyBaseUrl()).toBe('https://proxy.example');
    });
});

/**
 * The client and the Worker agree on the wire format through two independent
 * sets of string literals — `PROXY_*_PATH` and the `url` parameter here,
 * `'/random'`/`'/download'`/`'url'` there. Nothing else tests across that
 * boundary, so renaming a route on either side leaves both suites green and
 * 404s every photo request in production.
 */
describe('client/Worker route contract', () => {
    it('routes a URL the client builds for a random photo', () => {
        const built = buildRandomPhotoUrl(PROXY, 'face', 'portrait', 4);

        const resolved = resolveUpstream(new URL(built));

        expect(resolved.ok).toBe(true);
        const upstream = new URL((resolved as { url: string }).url);
        expect(upstream.pathname).toBe('/photos/random');
        expect(upstream.searchParams.get('query')).toBe('face');
        expect(upstream.searchParams.get('orientation')).toBe('portrait');
        expect(upstream.searchParams.get('count')).toBe('4');
    });

    it('routes the URL the client builds for a download trigger', async () => {
        const location = 'https://api.unsplash.com/photos/abc123/download?ixid=xyz';
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });

        await triggerPhotoDownload(
            location,
            PROXY,
            mockFetch as unknown as typeof fetch,
        );

        const resolved = resolveUpstream(
            new URL(mockFetch.mock.calls[0][0] as string),
        );

        expect(resolved.ok).toBe(true);
        const upstream = new URL((resolved as { url: string }).url);
        expect(upstream.pathname).toBe('/photos/abc123/download');
        expect(upstream.searchParams.get('ixid')).toBe('xyz');
    });

    it('emits exactly the parameters the Worker forwards', () => {
        // The other half of the seam: route names are pinned above, but the
        // parameter lists are independent too, and one added here without a
        // matching entry in RANDOM_PARAMS is dropped in silence — a new search
        // facet that quietly does nothing.
        const built = new URL(buildRandomPhotoUrl(PROXY, 'face', 'portrait', 4));

        expect([...built.searchParams.keys()].sort()).toEqual(
            [...RANDOM_PARAMS].sort(),
        );
    });
});
