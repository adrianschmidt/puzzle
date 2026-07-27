/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';
import type { GameState } from '../model/types.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { diagnostics } from '../diagnostics.js';

vi.mock('../ui/index.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ui/index.js')>()),
    showLoadingOverlay: vi.fn(),
    hideLoadingOverlay: vi.fn(),
    yieldForPaint: vi.fn(async () => {}),
}));
vi.mock('../images/index.js', () => ({
    getUnsplashAccessKey: vi.fn(),
    triggerPhotoDownload: vi.fn(async () => {}),
}));
// jsdom has no real canvas 2D context (`getContext('2d')` returns null), so
// the real `createBlankImageDataUrl` throws in this environment regardless
// of what it's asked to draw — stub it rather than fight the DOM.
vi.mock('./blank-canvas.js', () => ({
    createBlankImageDataUrl: vi.fn(() => 'data:image/png;base64,blank'),
}));
// `createNewGame` below runs for real, and its generator registry imports
// `tracedTabGeneratorStub` from this same module — replacing the whole
// module (rather than passing through the rest via `importOriginal`) would
// leave the registry without it and break every real generation.
vi.mock('../puzzle/topology/traced-tab-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../puzzle/topology/traced-tab-loader.js')>();
    return { ...actual, preloadTracedTabGenerator: vi.fn(async () => {}) };
});
// `resolveUnsplashImage` is not exercised by these tests (every test either
// picks a photo directly or has no access key), so it is stubbed rather than
// left real — otherwise it would reach the real `fetchRandomImage` behind
// the `../images/index.js` mock above, which doesn't export it. Stubbing it
// also gives the "no second API call" test below something to assert on.
vi.mock('./resolve-image.js', () => ({ resolveUnsplashImage: vi.fn() }));
// Plain `vi.spyOn` can't intercept the call `start-new-game.ts` makes to
// `createNewGame` imported from another module under Vite; wrap the real
// implementation via `vi.mock` passthrough so the paint-before-generation
// ordering test below can see when it actually ran, while every other test
// still gets a real generated puzzle.
vi.mock('../game/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../game/index.js')>();
    return { ...actual, createNewGame: vi.fn(actual.createNewGame) };
});

import { showLoadingOverlay, hideLoadingOverlay, yieldForPaint } from '../ui/index.js';
import { getUnsplashAccessKey, triggerPhotoDownload } from '../images/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { resolveUnsplashImage } from './resolve-image.js';
import { createNewGame } from '../game/index.js';
import { startNewGame, type StartNewGameDeps, type StartNewGameOptions } from './start-new-game.js';

/**
 * The real generation logic the `../game/index.js` mock above wraps,
 * captured once so `beforeEach` can restore it explicitly. `vi.clearAllMocks()`
 * only clears call records, not a `mockReturnValue`/`mockImplementation`
 * override a single test set — without this restore, a stub installed by
 * one test (e.g. the falsy-rejection test below) would silently leak into
 * every test declared after it.
 */
const realCreateNewGame = vi.mocked(createNewGame).getMockImplementation()!;

/**
 * Options for a start that must complete real piece generation without
 * touching the real lazy traced-tab chunk (only the mocked
 * `preloadTracedTabGenerator` above is loaded in this file, so the real
 * chunk's tab generator is never registered). Composable with an explicit
 * non-traced `'classic'` tab generator never asks the registry for it.
 */
function noTracedTabsOptions(overrides: Partial<StartNewGameOptions> = {}): StartNewGameOptions {
    return {
        cutStyle: 'composable',
        composableConfig: { tabGenerator: 'classic' },
        imageSource: 'blank',
        ...overrides,
    };
}

describe('startNewGame', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let install: Mock<(state: GameState) => void>;
    let resetViewport: Mock<() => void>;
    let fitView: Mock<(state: GameState) => void>;
    let persistNewPuzzle: Mock<(state: GameState) => void>;
    let onGameAnalytics: Mock<(data: unknown) => void>;
    let deps: StartNewGameDeps;
    /**
     * Installed by the tests that assert on it, and restored one by one
     * rather than through `vi.restoreAllMocks()`: `vite.config.ts` sets no
     * `restoreMocks`, and a blanket restore here would also strip the
     * implementations the `vi.mock` factories above installed.
     */
    let warnSpy: MockInstance<typeof diagnostics.warn> | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getUnsplashAccessKey).mockReturnValue(undefined);
        vi.mocked(preloadTracedTabGenerator).mockResolvedValue(undefined);
        vi.mocked(resolveUnsplashImage).mockResolvedValue(null);
        vi.mocked(createNewGame).mockImplementation(realCreateNewGame);

        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        install = vi.fn();
        resetViewport = vi.fn();
        fitView = vi.fn();
        persistNewPuzzle = vi.fn();
        onGameAnalytics = vi.fn();
        deps = {
            container: document.createElement('div'),
            session: { install, current: () => makeGameState(), hasGame: () => true, restoreSelection: vi.fn() },
            resetViewport,
            fitView,
            persistNewPuzzle,
            onGameAnalytics,
        };
    });

    afterEach(() => {
        warnSpy?.mockRestore();
        warnSpy = undefined;
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('installs a puzzle, fits the view and persists it', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        expect(install).toHaveBeenCalledTimes(1);
        expect(fitView).toHaveBeenCalled();
        expect(persistNewPuzzle).toHaveBeenCalled();
        expect(resetViewport).toHaveBeenCalled();
        // The viewport is reset before generation, not merely at some point
        // during the start — otherwise pieces could be randomized against
        // whatever transform the previous game left behind.
        const resetOrder = vi.mocked(resetViewport).mock.invocationCallOrder[0];
        const createOrder = vi.mocked(createNewGame).mock.invocationCallOrder[0];
        expect(resetOrder).toBeLessThan(createOrder);
    });

    it('shows the loading overlay and always hides it', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
        expect(showLoadingOverlay).toHaveBeenCalled();
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    // Pins ordering step 5: `hideLoadingOverlay()` runs in a `finally`.
    it('hides the loading overlay even when generation throws', async () => {
        install.mockImplementation(() => {
            throw new Error('install boom');
        });

        await expect(
            startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps),
        ).rejects.toThrow('install boom');
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('reports new-game-started with the fresh source, and records it as the current analytics', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
        expect(umamiTrack).toHaveBeenCalledWith(
            'new-game-started',
            expect.objectContaining({ source: 'fresh' }),
        );
        expect(onGameAnalytics).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'fresh' }),
        );
        // The control for `flags a boot-fallback game in analytics` below,
        // and the same argument as the healthy-Classic control further down:
        // an ordinary start must carry no `bootFallback` key at all. Absence,
        // not `false`, is what `umami.ts` tells operators to subtract to size
        // the #488 recovery bucket — so setting the flag unconditionally at
        // the `buildFreshGameData` call site would inflate exactly the bucket
        // the query removes, and without this line it passes the whole suite.
        expect(umamiTrack).toHaveBeenCalledTimes(1);
        expect(umamiTrack.mock.calls[0][1]).not.toHaveProperty('bootFallback');
    });

    // Pins ordering step 1: the boot fallback forces the plan before
    // anything else runs, so the recovery path never touches the chunk.
    it('never fetches the traced chunk for a boot-fallback start', async () => {
        // The recovery path must not be able to fail the way the start it is
        // recovering from did.
        await startNewGame({ cols: 2, rows: 2 }, { bootFallback: true, imageSource: 'blank' }, deps);
        expect(preloadTracedTabGenerator).not.toHaveBeenCalled();
    });

    it('flags a boot-fallback game in analytics', async () => {
        await startNewGame({ cols: 2, rows: 2 }, { bootFallback: true, imageSource: 'blank' }, deps);
        expect(umamiTrack).toHaveBeenCalledWith(
            'new-game-started',
            expect.objectContaining({ bootFallback: true }),
        );
    });

    // The whole degraded-Classic seam, end to end. Classic declares
    // `tracedTabs: 'always'`, so the chunk preload starts; it is the only
    // style that survives the fetch failing, because the legacy
    // straight-grid generator needs no chunk. Every other style throws on
    // the `'fail'` outcome and never reaches the payload.
    //
    // This is the flag `umami.ts` leans on hardest: without it a degraded
    // game is indistinguishable from genuine pre-upgrade Classic traffic
    // (both are `classic` with no `traceSetVersion`), which is the metric
    // that decides when the legacy generator can be retired. The two ends
    // are each covered in isolation — `traced-tab-plan.test.ts` on the
    // outcome, `new-game-payload.test.ts` on the builder — but nothing
    // drove a degrading start through this file, so dropping
    // `chunkDegraded` from the `buildFreshGameData` call emptied the
    // bucket silently.
    it('flags a Classic game degraded by a failed chunk fetch, and warns', async () => {
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        const chunkError = new Error('chunk boom');
        vi.mocked(preloadTracedTabGenerator).mockRejectedValue(chunkError);

        await startNewGame(
            { cols: 2, rows: 2 },
            { cutStyle: 'classic', imageSource: 'blank' },
            deps,
        );

        // The start completed on the legacy cut rather than throwing.
        expect(install).toHaveBeenCalledTimes(1);
        expect(umamiTrack).toHaveBeenCalledWith(
            'new-game-started',
            expect.objectContaining({ cutStyle: 'classic', tracedChunkDegraded: true }),
        );
        expect(onGameAnalytics).toHaveBeenCalledWith(
            expect.objectContaining({ tracedChunkDegraded: true }),
        );
        // Quiet for the player, not for us — and it carries the reason, so
        // a dev console says why Classic silently changed shape.
        expect(warnSpy).toHaveBeenCalledWith(expect.any(String), chunkError);
    });

    it('leaves a healthy Classic start unflagged', async () => {
        // The control for the case above: same style, same code path, but
        // `preloadTracedTabGenerator` resolves — so the payload must carry
        // no `tracedChunkDegraded` key at all. Absence, not `false`, is what
        // the pre-upgrade-tail query subtracts on. Without this, setting the
        // flag unconditionally passes.
        //
        // Generation is stubbed here and only here on the Classic path: a
        // *healthy* Classic start stamps `classicConfig` and runs the traced
        // pipeline, and the real lazy chunk is never loaded in this file
        // (only the mocked `preloadTracedTabGenerator` above is), so real
        // generation would throw for a reason that has nothing to do with
        // the flag. The degraded case above needs no stub — falling back to
        // the legacy cut is exactly what makes it generable here.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await startNewGame(
            { cols: 2, rows: 2 },
            { cutStyle: 'classic', imageSource: 'blank' },
            deps,
        );

        expect(umamiTrack).toHaveBeenCalledTimes(1);
        expect(umamiTrack.mock.calls[0][1]).not.toHaveProperty('tracedChunkDegraded');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    // Pins ordering step 3: the chunk outcome is collected before the
    // download report, so a start about to throw must not credit a photo it
    // discards. Uses a picked image (rather than the random-fetch path) so
    // `downloadLocation` is set unconditionally on success — otherwise the
    // assertion below would pass whether or not the ordering was correct.
    it('does not report an Unsplash download when the start throws first', async () => {
        vi.mocked(getUnsplashAccessKey).mockReturnValue('key');
        vi.mocked(preloadTracedTabGenerator).mockRejectedValue(new Error('chunk boom'));

        await expect(
            startNewGame(
                { cols: 2, rows: 2 },
                { cutStyle: 'wavy', pickedImage: makeCandidateImage() },
                deps,
            ),
        ).rejects.toThrow('chunk boom');
        expect(triggerPhotoDownload).not.toHaveBeenCalled();
    });

    // Falsy-rejection defaulting: `null` is the await site's success
    // sentinel, so a chunk-fetch rejection whose reason is itself `null`
    // must be defaulted to a real Error, or it reads as "the chunk loaded
    // fine" and lets generation proceed. `createNewGame` is stubbed to
    // succeed regardless of traced-tab availability, so a wrongly-read
    // success reaches `install` instead of merely throwing for the
    // unrelated reason that the real chunk was never loaded in this file —
    // otherwise this test would pass whether or not the default is applied.
    it('treats a null chunk-fetch rejection as a real failure, not the success sentinel', async () => {
        vi.mocked(preloadTracedTabGenerator).mockRejectedValue(null);
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await expect(
            startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy', imageSource: 'blank' }, deps),
        ).rejects.toThrow();
        expect(install).not.toHaveBeenCalled();
    });

    it('skips the access-key lookup for a blank puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
        expect(getUnsplashAccessKey).not.toHaveBeenCalled();
    });

    it('skips the access-key lookup for the first-run puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions({ imageSource: 'first-run' }), deps);
        expect(getUnsplashAccessKey).not.toHaveBeenCalled();
    });

    it('uses a player-picked photo directly, without a second Unsplash fetch', async () => {
        vi.mocked(getUnsplashAccessKey).mockReturnValue('key');
        const picked = makeCandidateImage();

        await startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions({ imageSource: undefined, pickedImage: picked }),
            deps,
        );

        expect(resolveUnsplashImage).not.toHaveBeenCalled();
        expect(triggerPhotoDownload).toHaveBeenCalledWith(picked.downloadLocation, 'key');
    });

    // Pins ordering step 2 (first half): the chunk preload is started
    // synchronously, before the function's first `await` — so it overlaps
    // whatever image resolution follows rather than running ahead of it.
    // The style needs traced tabs so `preloadChunk` is true; the outcome is
    // irrelevant here (the real chunk is never loaded in this test file),
    // so the rejection is swallowed rather than asserted on.
    it('starts the traced chunk fetch synchronously, before awaiting anything', async () => {
        const promise = startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy', imageSource: 'blank' }, deps);
        expect(preloadTracedTabGenerator).toHaveBeenCalledTimes(1);
        await promise.catch(() => {});
    });

    // Pins ordering step 2 (second half): the chunk preload is awaited
    // *after* the image request, not immediately after it starts — so the
    // two overlap. The preload's promise only resolves once
    // `resolveUnsplashImage` releases it; if the implementation awaited the
    // chunk before resolving the image, `resolveUnsplashImage` would never
    // run, the preload would never resolve, and this test would hang and
    // time out rather than fail an assertion.
    it('overlaps the chunk fetch with the image request, rather than awaiting it first', async () => {
        let release!: () => void;
        vi.mocked(preloadTracedTabGenerator).mockReturnValue(
            new Promise<void>((resolve) => { release = resolve; }),
        );
        vi.mocked(getUnsplashAccessKey).mockReturnValue('key');
        vi.mocked(resolveUnsplashImage).mockImplementation(async () => {
            release();
            return null;
        });
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy' }, deps);

        expect(resolveUnsplashImage).toHaveBeenCalled();
    });

    // Pins ordering step 4: the loading overlay gets a paint before the
    // synchronous piece-generation burst.
    it('yields for paint before the synchronous piece-generation burst', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        const yieldOrder = vi.mocked(yieldForPaint).mock.invocationCallOrder[0];
        const createOrder = vi.mocked(createNewGame).mock.invocationCallOrder[0];
        expect(yieldOrder).toBeLessThan(createOrder);
    });
});

/** A fully-populated player-picked candidate, for the "picked image" paths. */
function makeCandidateImage() {
    return {
        imageUrl: 'https://images.unsplash.com/picked.jpg',
        imageSize: { width: 400, height: 300 },
        attribution: {
            photographerName: 'A Photographer',
            photographerUrl: 'https://unsplash.com/@photographer',
            photoUrl: 'https://unsplash.com/photos/abc123',
        },
        downloadLocation: 'https://api.unsplash.com/photos/abc123/download',
        thumbUrl: 'https://images.unsplash.com/picked-thumb.jpg',
    };
}
