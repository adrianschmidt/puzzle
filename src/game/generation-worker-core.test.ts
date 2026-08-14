import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `importOriginal` keeps the real `tracedTabGeneratorStub` export intact —
// `generator-registry.ts` imports it to pre-register the 'traced' id, and
// replacing the whole module would hand that registration `undefined`, throwing
// at import time. Only `preloadTracedTabGenerator` is mocked.
vi.mock('../puzzle/topology/traced-tab-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../puzzle/topology/traced-tab-loader.js')>();
    return { ...actual, preloadTracedTabGenerator: vi.fn() };
});

import {
    preloadTracedTabGenerator,
    tracedTabGeneratorStub,
} from '../puzzle/topology/traced-tab-loader.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { classicTabGenerator } from '../puzzle/topology/classic-tab-generator.js';
import { handleGenerationRequest } from './generation-worker-core.js';
import type { GenerationRequest } from './generation-core.js';

const LEGACY_CLASSIC: GenerationRequest = {
    cutStyle: 'classic',
    gridSize: { cols: 4, rows: 3 },
    imageSize: { width: 1080, height: 720 },
    seed: 42,
    tabDebug: false,
};

const TRACED: GenerationRequest = { ...LEGACY_CLASSIC, cutStyle: 'triangles' };

/**
 * Stand in for the generator the lazy chunk registers under `'traced'`, so a
 * test can exercise the happy traced path without the trace dataset. Delegates
 * to the classic generator; only the registry id matters here.
 */
function registerTracedStandIn(): void {
    registerTabGenerator({ ...classicTabGenerator, id: 'traced' });
}

beforeEach(() => {
    vi.mocked(preloadTracedTabGenerator).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    // The registry is module state shared by every test in this file.
    registerTabGenerator(tracedTabGeneratorStub);
});

describe('handleGenerationRequest', () => {
    it('generates without touching the traced chunk for legacy classic', async () => {
        const response = await handleGenerationRequest(LEGACY_CLASSIC);
        expect(response.ok).toBe(true);
        if (response.ok) expect(response.result.pieces).toHaveLength(12);
        expect(preloadTracedTabGenerator).not.toHaveBeenCalled();
    });

    it('awaits the traced chunk before generating a traced request', async () => {
        // A pending preload must keep the whole handler pending. Asserting only
        // `toHaveBeenCalledOnce()` would also pass a fire-and-forget impl — the
        // regression that matters: generation running against an unloaded chunk.
        let releasePreload!: () => void;
        vi.mocked(preloadTracedTabGenerator).mockReturnValue(
            new Promise<void>((resolve) => { releasePreload = resolve; }),
        );
        registerTracedStandIn();

        let settled = false;
        const pending = handleGenerationRequest(TRACED)
            .then((response) => { settled = true; return response; });

        await Promise.resolve();
        await Promise.resolve();
        expect(preloadTracedTabGenerator).toHaveBeenCalledOnce();
        expect(settled).toBe(false);

        releasePreload();
        const response = await pending;
        expect(response.ok).toBe(true);
    });

    it('generates a traced request once the chunk has registered its generator', async () => {
        registerTracedStandIn();
        const response = await handleGenerationRequest(TRACED);
        expect(response.ok).toBe(true);
        if (response.ok) expect(response.result.pieces.length).toBeGreaterThan(0);
    });

    it('reports a rejected preload as an infrastructure failure', async () => {
        vi.mocked(preloadTracedTabGenerator)
            .mockRejectedValue(new TypeError('chunk fetch failed'));
        const response = await handleGenerationRequest(TRACED);
        // `kind: 'infrastructure'` tells the client to retry on the main thread
        // (its own chunk copy); `name` survives the boundary so the analytics
        // reason isn't a bare message.
        expect(response).toEqual({
            ok: false,
            kind: 'infrastructure',
            error: 'chunk fetch failed',
            name: 'TypeError',
        });
    });

    it('reports an unloaded traced library as infrastructure, not generation', async () => {
        // Traced generation with a resolved-but-empty registry: the real
        // `tracedTabGeneratorStub` is registered under 'traced' but its delegate
        // is unfilled (the mocked preload registers nothing), so `ensureLoaded()`
        // throws — the real failure mode if `requestNeedsTracedTabs` drifts from
        // what generation reaches for.
        //
        // `'infrastructure'`, though the throw came from `runGeneration`: it
        // means the chunk is missing from THIS realm, and the main-thread
        // fallback (which preloads it) succeeds. `'generation'` would have the
        // client rethrow the one error the fallback exists to rescue.
        const response = await handleGenerationRequest(TRACED);
        expect(response.ok).toBe(false);
        if (!response.ok) {
            expect(response.kind).toBe('infrastructure');
            expect(response.error).toContain('Traced tab library not loaded');
            expect(response.name).toBe('TracedTabLibraryNotLoadedError');
        }
    });

    it('reports any other generation throw as a deterministic generation failure', async () => {
        // Counterpart to the test above: a throw that IS a function of the
        // request stays `'generation'`, so the client surfaces it rather than
        // paying a second generation to reproduce it.
        registerTabGenerator({
            ...classicTabGenerator,
            id: 'traced',
            generate() { throw new TypeError('x is not a function'); },
        });
        const response = await handleGenerationRequest(TRACED);
        expect(response).toEqual({
            ok: false,
            kind: 'generation',
            error: 'x is not a function',
            name: 'TypeError',
        });
    });
});
