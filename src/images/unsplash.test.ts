/**
 * Tests for the Unsplash API client.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildRandomPhotoUrl,
    parseUnsplashResponse,
    fetchRandomImage,
    fetchRandomImages,
    triggerPhotoDownload,
    UNSPLASH_RANDOM_URL,
} from './unsplash.js';

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
    it('builds URL with orientation=landscape and client_id', () => {
        const url = buildRandomPhotoUrl('my-test-key');

        expect(url).toContain(UNSPLASH_RANDOM_URL);
        expect(url).toContain('orientation=landscape');
        expect(url).toContain('client_id=my-test-key');
    });

    it('properly encodes the access key', () => {
        const url = buildRandomPhotoUrl('key with spaces');

        expect(url).toContain('client_id=key+with+spaces');
    });

    it('includes query parameter when provided', () => {
        const url = buildRandomPhotoUrl('test-key', 'nature landscape');

        expect(url).toContain('query=nature+landscape');
        expect(url).toContain('orientation=landscape');
        expect(url).toContain('client_id=test-key');
    });

    it('omits query parameter when undefined', () => {
        const url = buildRandomPhotoUrl('test-key', undefined);

        expect(url).not.toContain('query=');
    });

    it('omits query parameter when empty string', () => {
        const url = buildRandomPhotoUrl('test-key', '');

        expect(url).not.toContain('query=');
    });

    it('uses orientation=portrait when requested', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'portrait');

        expect(url).toContain('orientation=portrait');
    });

    it('uses orientation=landscape when requested', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'landscape');

        expect(url).toContain('orientation=landscape');
    });

    it('includes count when provided', () => {
        const url = buildRandomPhotoUrl('test-key', undefined, 'landscape', 4);

        expect(url).toContain('count=4');
    });

    it('omits count when not provided', () => {
        const url = buildRandomPhotoUrl('test-key');

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

        const result = await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch);

        expect(result).toBeDefined();
        expect(result!.imageUrl).toBe(responseData.urls.regular);
        expect(result!.photographerName).toBe('Test Photographer');
    });

    it('calls the correct URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage('my-key-123', mockFetch as unknown as typeof fetch);

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain(UNSPLASH_RANDOM_URL);
        expect(calledUrl).toContain('client_id=my-key-123');
        expect(calledUrl).toContain('orientation=landscape');
    });

    it('returns undefined on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch);

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
        const result = await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch);

        expect(result).toBeUndefined();
        warnSpy.mockRestore();
    });

    it('passes query parameter to the URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch, 'nature landscape');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('query=nature+landscape');
    });

    it('omits query parameter when not provided', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch);

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).not.toContain('query=');
    });

    it('propagates fetch exceptions', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            fetchRandomImage('test-key', mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Network error');
    });

    it('threads portrait orientation into the request URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await fetchRandomImage('test-key', mockFetch as unknown as typeof fetch, 'city', 'portrait');

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

        const results = await fetchRandomImages('test-key', 2, mockFetch as unknown as typeof fetch);

        expect(results).toHaveLength(2);
        expect(results![0].imageUrl).toBe('https://images.unsplash.com/photo-abc?w=1080');
        expect(results![0].thumbUrl).toBe('https://images.unsplash.com/photo-abc?w=400');
    });

    it('requests the given count and orientation', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([makeUnsplashResponse()]),
        });

        await fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch, 'nature', 'portrait');

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
        const results = await fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch);

        expect(results).toBeUndefined();
        warnSpy.mockRestore();
    });

    it('throws when the body is not an array', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeUnsplashResponse()),
        });

        await expect(
            fetchRandomImages('test-key', 4, mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Invalid Unsplash API response');
    });
});

describe('triggerPhotoDownload', () => {
    it('calls the download location with client_id appended', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });

        await triggerPhotoDownload(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
            'my-key',
            mockFetch as unknown as typeof fetch,
        );

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
        expect(calledUrl.searchParams.get('client_id')).toBe('my-key');
        expect(calledUrl.searchParams.get('ixid')).toBe('xyz');
        expect(calledUrl.pathname).toBe('/photos/abc123/download');
    });

    it('warns but does not throw on HTTP error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            triggerPhotoDownload('https://api.unsplash.com/x/download', 'k', mockFetch as unknown as typeof fetch),
        ).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});
