import { describe, it, expect, vi } from 'vitest';
import { isStashImageRequest, createStashImageHandler } from './stash-image-handler.js';
import { OFFLINE_STASH_CACHE } from '../images/offline-stash-cache.js';

const IMAGE_URL = 'https://images.unsplash.com/photo-1?w=1080';

function makeCacheStorage(entries: Record<string, unknown>): CacheStorage {
    return {
        open: async (name: string) => {
            expect(name).toBe(OFFLINE_STASH_CACHE);
            return { match: async (url: string) => entries[url] };
        },
    } as unknown as CacheStorage;
}

describe('isStashImageRequest', () => {
    it('matches Unsplash CDN URLs', () => {
        expect(isStashImageRequest(new URL(IMAGE_URL))).toBe(true);
    });

    it('ignores other hosts', () => {
        expect(isStashImageRequest(new URL('https://api.unsplash.com/photos/p1/download'))).toBe(false);
        expect(isStashImageRequest(new URL('https://example.com/index.html'))).toBe(false);
    });
});

describe('createStashImageHandler', () => {
    const request = { url: IMAGE_URL } as Request;

    it('serves a stashed response without touching the network', async () => {
        const cached = { status: 200 };
        const fetchFn = vi.fn();
        const handler = createStashImageHandler(
            makeCacheStorage({ [IMAGE_URL]: cached }),
            fetchFn as unknown as typeof fetch,
        );

        expect(await handler({ request })).toBe(cached);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('falls through to the network on a cache miss', async () => {
        const network = { status: 200 };
        const fetchFn = vi.fn(async () => network);
        const handler = createStashImageHandler(
            makeCacheStorage({}),
            fetchFn as unknown as typeof fetch,
        );

        expect(await handler({ request })).toBe(network);
        expect(fetchFn).toHaveBeenCalledWith(request);
    });

    it('falls through to the network when the cache lookup throws', async () => {
        const network = { status: 200 };
        const fetchFn = vi.fn(async () => network);
        const cacheStorage = {
            open: async () => {
                throw new Error('cache unavailable');
            },
        } as unknown as CacheStorage;

        expect(await createStashImageHandler(cacheStorage, fetchFn as unknown as typeof fetch)({ request }))
            .toBe(network);
    });
});
