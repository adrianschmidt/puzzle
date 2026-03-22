/**
 * Tests for the Unsplash API client.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildRandomPhotoUrl,
    parseUnsplashResponse,
    fetchRandomImage,
    UNSPLASH_RANDOM_URL,
} from './unsplash.js';

/** A valid Unsplash API response for testing. */
function makeUnsplashResponse() {
    return {
        urls: {
            regular: 'https://images.unsplash.com/photo-abc?w=1080',
            full: 'https://images.unsplash.com/photo-abc',
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
        },
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

    it('propagates fetch exceptions', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            fetchRandomImage('test-key', mockFetch as unknown as typeof fetch),
        ).rejects.toThrow('Network error');
    });
});
