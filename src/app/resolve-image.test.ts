/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../images/index.js', () => ({ fetchRandomImage: vi.fn() }));

import { fetchRandomImage } from '../images/index.js';
import { GenerationCanceledError } from '../game/index.js';
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
            thumbUrl: 'https://images.unsplash.com/photo-abc?w=400',
            downloadLocation: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        });

        const resolved = await resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape');

        expect(resolved).toEqual({
            imageUrl: 'https://images.example/photo',
            imageSize: { width: 1080, height: 540 },
            attribution: {
                photographerName: 'Ada',
                photographerUrl: 'https://u.example/ada',
                photoUrl: 'https://p.example/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        });
        expect(resolved!.downloadLocation).toBe(
            'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        );
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('returns null and reports nothing itself when no image is found (4xx/5xx is tracked one layer down)', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue(undefined);

        const resolved = await resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape');

        expect(resolved).toBeNull();
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('reports image-fetch-failed and returns null when the fetch throws', async () => {
        vi.mocked(fetchRandomImage).mockRejectedValue(new Error('network down'));

        const resolved = await resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape');

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
            thumbUrl: 'https://images.unsplash.com/photo-abc?w=400',
            downloadLocation: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
        });

        const resolved = await resolveUnsplashImage('https://proxy.example', 'any', false, 'portrait');

        expect(vi.mocked(fetchRandomImage).mock.calls[0][3]).toBe('portrait');
        // 1080 wide, height derived from the 2:3 portrait aspect.
        expect(resolved?.imageSize).toEqual({ width: 1080, height: 1620 });
    });

    it('forwards the abort signal to fetchRandomImage', async () => {
        vi.mocked(fetchRandomImage).mockResolvedValue(undefined);
        const { signal } = new AbortController();

        await resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape', signal);

        expect(vi.mocked(fetchRandomImage).mock.calls[0][4]).toBe(signal);
    });

    it('throws GenerationCanceledError when the fetch is aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.mocked(fetchRandomImage).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        await expect(
            resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape', controller.signal),
        ).rejects.toBeInstanceOf(GenerationCanceledError);
    });

    it('keys cancellation off the aborted signal, not the error type', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.mocked(fetchRandomImage).mockRejectedValue(new Error('network down'));

        await expect(
            resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape', controller.signal),
        ).rejects.toBeInstanceOf(GenerationCanceledError);
    });

    it('does not report image-fetch-failed when the fetch is aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.mocked(fetchRandomImage).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        await resolveUnsplashImage('https://proxy.example', 'any', false, 'landscape', controller.signal)
            .catch(() => {});

        expect(umamiTrack).not.toHaveBeenCalled();
    });
});
