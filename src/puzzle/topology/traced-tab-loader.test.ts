/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const trackMock = vi.fn();

vi.mock('../../analytics/index.js', () => ({
    track: (...args: unknown[]) => trackMock(...args),
}));

describe('preloadTracedTabGenerator analytics', () => {
    beforeEach(() => {
        vi.resetModules();
        trackMock.mockReset();
    });

    it('emits traced-chunk-loaded with a durationMs on success', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            tracedTabGenerator: {
                id: 'traced',
                generate: () => null,
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await preloadTracedTabGenerator();

        expect(trackMock).toHaveBeenCalledOnce();
        const [name, data] = trackMock.mock.calls[0];
        expect(name).toBe('traced-chunk-loaded');
        expect(data).toMatchObject({ durationMs: expect.any(Number) });
        expect((data as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not re-emit when the cached promise is returned', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            tracedTabGenerator: {
                id: 'traced',
                generate: () => null,
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await preloadTracedTabGenerator();
        await preloadTracedTabGenerator();
        await preloadTracedTabGenerator();

        expect(trackMock).toHaveBeenCalledOnce();
    });

    it('emits traced-chunk-load-failed with the rejection reason', async () => {
        // Simulate a failed dynamic import by exposing `tracedTabGenerator`
        // as a throwing getter — the loader's `.then(m => m.tracedTabGenerator)`
        // turns the throw into a promise rejection, matching the real
        // network-failure shape closely enough.
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error('Failed to fetch dynamically imported module');
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow(
            'Failed to fetch dynamically imported module',
        );

        expect(trackMock).toHaveBeenCalledOnce();
        expect(trackMock).toHaveBeenCalledWith('traced-chunk-load-failed', {
            reason: 'Failed to fetch dynamically imported module',
        });
    });

    it('truncates very long failure reasons so analytics stays bounded', async () => {
        const longMessage = 'x'.repeat(500);
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error(longMessage);
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow();

        const failed = trackMock.mock.calls.find(
            ([name]) => name === 'traced-chunk-load-failed',
        );
        expect(failed).toBeDefined();
        const reason = (failed![1] as { reason: string }).reason;
        expect(reason.length).toBe(200);
        expect(reason).toBe('x'.repeat(200));
    });
});
