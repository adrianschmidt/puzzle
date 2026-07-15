/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../images/index.js', () => ({ fetchRandomImage: vi.fn() }));

import { fetchRandomImage } from '../images/index.js';
import { resolveUnsplashImage } from './resolve-image.js';

describe('resolveUnsplashImage', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    it('maps a fetched photo into a ResolvedImage and reports nothing', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue({
            imageUrl: 'https://images.example/photo',
            width: 2000,
            height: 1000,
            photographerName: 'Ada',
            photographerUrl: 'https://u.example/ada',
            photoUrl: 'https://p.example/1',
        });

        const resolved = await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());

        expect(resolved).toEqual({
            imageUrl: 'https://images.example/photo',
            imageSize: { width: 1080, height: 540 },
            attribution: {
                photographerName: 'Ada',
                photographerUrl: 'https://u.example/ada',
                photoUrl: 'https://p.example/1',
            },
        });
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('returns null and reports nothing when no image is found (4xx/5xx)', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue(undefined);

        const resolved = await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());

        expect(resolved).toBeNull();
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('reports image-fetch-failed and returns null when the fetch throws', async () => {
        vi.mocked(fetchRandomImage).mockRejectedValue(new Error('network down'));

        const resolved = await resolveUnsplashImage('key', 'any', false, 'landscape', vi.fn());

        expect(resolved).toBeNull();
        expect(umamiTrack).toHaveBeenCalledWith('image-fetch-failed', {
            reason: 'network down',
            orientation: 'landscape',
            imageCategory: 'any',
        });
    });

    it('forwards orientation to fetchRandomImage and scales a portrait photo', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue({
            imageUrl: 'https://images.example/portrait',
            width: 2000,
            height: 3000,
            photographerName: 'Ada',
            photographerUrl: 'https://u.example/ada',
            photoUrl: 'https://p.example/1',
        });

        const fetchFn = vi.fn();
        const resolved = await resolveUnsplashImage('key', 'any', false, 'portrait', fetchFn);

        // Orientation is forwarded as the 4th arg to fetchRandomImage.
        expect(vi.mocked(fetchRandomImage).mock.calls[0][3]).toBe('portrait');
        // 1080 wide, height derived from the 2:3 portrait aspect.
        expect(resolved?.imageSize).toEqual({ width: 1080, height: 1620 });
    });
});
