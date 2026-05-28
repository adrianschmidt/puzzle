/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const trackMock = vi.fn();

vi.mock('../../analytics/index.js', () => ({
    track: (...args: unknown[]) => trackMock(...args),
}));

function callsNamed(name: string): unknown[][] {
    return trackMock.mock.calls.filter(([eventName]) => eventName === name);
}

function payloadOf(name: string): Record<string, unknown> {
    const call = trackMock.mock.calls.find(([eventName]) => eventName === name);
    expect(call, `expected a "${name}" event`).toBeDefined();
    return call![1] as Record<string, unknown>;
}

describe('preloadTracedTabGenerator analytics', () => {
    beforeEach(() => {
        vi.resetModules();
        trackMock.mockReset();
    });

    it('emits started then loaded with duration, cacheState and attempt on success', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            tracedTabGenerator: { id: 'traced', generate: () => null },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await preloadTracedTabGenerator();

        expect(callsNamed('traced-chunk-preload-started')).toHaveLength(1);
        expect(payloadOf('traced-chunk-preload-started')).toEqual({ attempt: 1 });

        const loaded = payloadOf('traced-chunk-loaded');
        expect(loaded.durationMs).toEqual(expect.any(Number));
        expect(loaded.durationMs as number).toBeGreaterThanOrEqual(0);
        expect(loaded.attempt).toBe(1);
        // The mocked import has no real Resource Timing entry, so this
        // resolves to 'unknown' here; the cacheState branches are
        // exercised directly below.
        expect(['cold', 'warm', 'revalidated', 'unknown']).toContain(loaded.cacheState);
    });

    it('does not re-emit when the cached promise is returned', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            tracedTabGenerator: { id: 'traced', generate: () => null },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await preloadTracedTabGenerator();
        await preloadTracedTabGenerator();
        await preloadTracedTabGenerator();

        expect(callsNamed('traced-chunk-preload-started')).toHaveLength(1);
        expect(callsNamed('traced-chunk-loaded')).toHaveLength(1);
    });

    it('emits failed with reason, kind and attempt on rejection', async () => {
        // Simulate a failed dynamic import by exposing `tracedTabGenerator`
        // as a throwing getter — the loader's `.then(m => m.tracedTabGenerator)`
        // turns the throw into a promise rejection, matching the real
        // network-failure shape for the catch handler under test.
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error('Failed to fetch dynamically imported module');
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow(
            'Failed to fetch dynamically imported module',
        );

        expect(payloadOf('traced-chunk-load-failed')).toEqual({
            reason: 'Failed to fetch dynamically imported module',
            kind: 'network',
            attempt: 1,
        });
    });

    it('re-emits a fresh started/loaded pair on the retry after a failure', async () => {
        let accesses = 0;
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator() {
                accesses += 1;
                if (accesses === 1) {
                    throw new Error('Failed to fetch dynamically imported module');
                }
                return { id: 'traced', generate: () => null };
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow();
        await preloadTracedTabGenerator();

        expect(callsNamed('traced-chunk-preload-started')).toHaveLength(2);
        expect(callsNamed('traced-chunk-load-failed')).toHaveLength(1);
        expect(callsNamed('traced-chunk-loaded')).toHaveLength(1);
        // The attempt counter advances across the retry, so a
        // failed -> loaded recovery isn't confused with two cold loads.
        expect(payloadOf('traced-chunk-load-failed').attempt).toBe(1);
        expect(payloadOf('traced-chunk-loaded').attempt).toBe(2);
    });

    it('redacts URLs and extension origins from the failure reason', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error(
                    'Failed to fetch dynamically imported module: '
                    + 'https://example.com/assets/traced-tab-generator-abc123.js',
                );
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow();

        const failed = payloadOf('traced-chunk-load-failed');
        expect(failed.reason).toBe('Failed to fetch dynamically imported module: <url>');
        expect(failed.reason).not.toContain('example.com');
        // Classification still works on the redacted text.
        expect(failed.kind).toBe('network');
    });

    it('falls back to "unknown" for an empty error message', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error('');
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow();

        expect(payloadOf('traced-chunk-load-failed').reason).toBe('unknown');
    });

    it('describes non-Error rejections via String(err)', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw 'boom';
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toBe('boom');

        expect(payloadOf('traced-chunk-load-failed').reason).toBe('boom');
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

        const reason = payloadOf('traced-chunk-load-failed').reason as string;
        expect(reason.length).toBe(200);
        expect(reason).toBe('x'.repeat(200));
    });

    it('redacts extension origins from the failure reason', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            get tracedTabGenerator(): never {
                throw new Error(
                    'Blocked by client: safari-web-extension://ABCD-1234/inject.js',
                );
            },
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow();

        const reason = payloadOf('traced-chunk-load-failed').reason as string;
        expect(reason).toBe('Blocked by client: <ext>');
        expect(reason).not.toContain('ABCD-1234');
    });

    it('treats a missing tracedTabGenerator export as a parse failure, not a load', async () => {
        vi.doMock('./traced-tab-generator.js', () => ({
            // Chunk resolves and parses, but the expected export is absent
            // (a tree-shake / rename regression). A real ESM namespace
            // returns undefined for a missing export; declare it
            // explicitly so the loader's guard — not vitest's mock proxy —
            // is what fires.
            tracedTabGenerator: undefined,
        }));

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await expect(preloadTracedTabGenerator()).rejects.toThrow(/tracedTabGenerator export/);

        expect(callsNamed('traced-chunk-loaded')).toHaveLength(0);
        const failed = payloadOf('traced-chunk-load-failed');
        expect(failed.kind).toBe('parse');
        expect(failed.attempt).toBe(1);
    });
});

describe('detectCacheState classification', () => {
    let originalGetEntriesByType: typeof performance.getEntriesByType;

    beforeEach(() => {
        vi.resetModules();
        trackMock.mockReset();
        originalGetEntriesByType = performance.getEntriesByType.bind(performance);
    });

    afterEach(() => {
        performance.getEntriesByType = originalGetEntriesByType;
    });

    async function cacheStateFor(
        entry: Partial<PerformanceResourceTiming> | null,
    ): Promise<unknown> {
        vi.doMock('./traced-tab-generator.js', () => ({
            tracedTabGenerator: { id: 'traced', generate: () => null },
        }));
        performance.getEntriesByType = ((type: string) =>
            type === 'resource' && entry ? [entry] : []
        ) as typeof performance.getEntriesByType;

        const { preloadTracedTabGenerator } = await import('./traced-tab-loader.js');
        await preloadTracedTabGenerator();
        return payloadOf('traced-chunk-loaded').cacheState;
    }

    const name = 'http://localhost/assets/traced-tab-generator-abc123.js';

    it('reports warm when nothing was transferred', async () => {
        expect(await cacheStateFor({ name, transferSize: 0, encodedBodySize: 16000 }))
            .toBe('warm');
    });

    it('reports revalidated for a body-less 304 (small transfer under body size)', async () => {
        expect(await cacheStateFor({ name, transferSize: 320, encodedBodySize: 16000 }))
            .toBe('revalidated');
    });

    it('reports cold when the full body was transferred', async () => {
        expect(await cacheStateFor({ name, transferSize: 16500, encodedBodySize: 16000 }))
            .toBe('cold');
    });

    it('reports unknown when no matching entry exists', async () => {
        expect(await cacheStateFor({
            name: 'http://localhost/assets/index-xyz.js',
            transferSize: 0,
            encodedBodySize: 100,
        })).toBe('unknown');
    });
});
