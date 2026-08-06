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
    getImageProxyBaseUrl: vi.fn(),
    triggerPhotoDownload: vi.fn(async () => {}),
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
// picks a photo directly or has no image proxy configured), so it is stubbed rather than
// left real — otherwise it would reach the real `fetchRandomImage` behind
// the `../images/index.js` mock above, which doesn't export it. Stubbing it
// also gives the "no second API call" test below something to assert on.
vi.mock('./resolve-image.js', () => ({ resolveUnsplashImage: vi.fn() }));
// Plain `vi.spyOn` can't intercept the call `start-new-game.ts` makes to
// `createNewGameAsync` imported from another module under Vite; wrap the
// real implementation via `vi.mock` passthrough so the paint-before-
// generation ordering test below can see when it actually ran (and the
// cancel tests below can inspect/react to the signal it's called with),
// while every other test still gets a real generated puzzle.
// `GenerationCanceledError` is spread through untouched via `...actual`.
vi.mock('../game/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../game/index.js')>();
    return { ...actual, createNewGameAsync: vi.fn(actual.createNewGameAsync) };
});

import { showLoadingOverlay, hideLoadingOverlay, yieldForPaint } from '../ui/index.js';
import { getImageProxyBaseUrl, triggerPhotoDownload } from '../images/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { resolveUnsplashImage } from './resolve-image.js';
import { createNewGameAsync, GenerationCanceledError } from '../game/index.js';
import { startNewGame, type StartNewGameDeps, type StartNewGameOptions } from './start-new-game.js';

/**
 * The real generation logic the `../game/index.js` mock above wraps,
 * captured once so `beforeEach` can restore it explicitly. `vi.clearAllMocks()`
 * only clears call records, not a `mockReturnValue`/`mockImplementation`
 * override a single test set — without this restore, a stub installed by
 * one test (e.g. the falsy-rejection test below) would silently leak into
 * every test declared after it.
 */
const realCreateNewGameAsync = vi.mocked(createNewGameAsync).getMockImplementation()!;

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
        vi.mocked(getImageProxyBaseUrl).mockReturnValue(undefined);
        vi.mocked(preloadTracedTabGenerator).mockResolvedValue(undefined);
        vi.mocked(resolveUnsplashImage).mockResolvedValue(null);
        vi.mocked(createNewGameAsync).mockImplementation(realCreateNewGameAsync);

        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        install = vi.fn();
        resetViewport = vi.fn();
        fitView = vi.fn();
        persistNewPuzzle = vi.fn();
        onGameAnalytics = vi.fn();
        deps = {
            container: document.createElement('div'),
            session: { install },
            resetViewport,
            fitView,
            persistNewPuzzle,
            onGameAnalytics,
            hasCurrentGame: () => false,
        };
    });

    afterEach(() => {
        warnSpy?.mockRestore();
        warnSpy = undefined;
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('installs a blank puzzle with no image', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        const state = install.mock.calls.at(-1)![0];
        expect(state.imageUrl).toBeNull();
        // The exact `blankSizeForOrientation` landscape size, not merely
        // non-zero: the bundled fallback is 1080×722, so a loose assertion
        // would pass even if the blank branch never ran.
        expect(state.imageSize).toEqual({ width: 1080, height: 720 });
    });

    it('installs a puzzle, fits the view and persists it', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        expect(install).toHaveBeenCalledTimes(1);
        expect(fitView).toHaveBeenCalled();
        expect(persistNewPuzzle).toHaveBeenCalled();
        expect(resetViewport).toHaveBeenCalled();
        // The viewport is reset only after generation has resolved, and
        // before the new state is installed — not any earlier, so a
        // canceled or throwing start (see the cancel tests below) never
        // touches the current puzzle's pan/zoom.
        const createOrder = vi.mocked(createNewGameAsync).mock.invocationCallOrder[0];
        const resetOrder = vi.mocked(resetViewport).mock.invocationCallOrder[0];
        const installOrder = vi.mocked(install).mock.invocationCallOrder[0];
        expect(createOrder).toBeLessThan(resetOrder);
        expect(resetOrder).toBeLessThan(installOrder);
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
        vi.mocked(createNewGameAsync).mockResolvedValue(makeAsyncGenerationResult());

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
        vi.mocked(getImageProxyBaseUrl).mockReturnValue('https://proxy.example');
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
    // fine" and lets generation proceed. `createNewGameAsync` is stubbed to
    // succeed regardless of traced-tab availability, so a wrongly-read
    // success reaches `install` instead of merely throwing for the
    // unrelated reason that the real chunk was never loaded in this file —
    // otherwise this test would pass whether or not the default is applied.
    it('treats a null chunk-fetch rejection as a real failure, not the success sentinel', async () => {
        vi.mocked(preloadTracedTabGenerator).mockRejectedValue(null);
        vi.mocked(createNewGameAsync).mockResolvedValue(makeAsyncGenerationResult());

        await expect(
            startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy', imageSource: 'blank' }, deps),
        ).rejects.toThrow();
        expect(install).not.toHaveBeenCalled();
    });

    it('skips the proxy-URL lookup for a blank puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
        expect(getImageProxyBaseUrl).not.toHaveBeenCalled();
    });

    it('skips the proxy-URL lookup for the first-run puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions({ imageSource: 'first-run' }), deps);
        expect(getImageProxyBaseUrl).not.toHaveBeenCalled();
    });

    it('uses a player-picked photo directly, without a second Unsplash fetch', async () => {
        vi.mocked(getImageProxyBaseUrl).mockReturnValue('https://proxy.example');
        const picked = makeCandidateImage();

        await startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions({ imageSource: undefined, pickedImage: picked }),
            deps,
        );

        expect(resolveUnsplashImage).not.toHaveBeenCalled();
        expect(triggerPhotoDownload).toHaveBeenCalledWith(
            picked.downloadLocation,
            'https://proxy.example',
        );
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
        vi.mocked(getImageProxyBaseUrl).mockReturnValue('https://proxy.example');
        vi.mocked(resolveUnsplashImage).mockImplementation(async () => {
            release();
            return null;
        });
        vi.mocked(createNewGameAsync).mockResolvedValue(makeAsyncGenerationResult());

        await startNewGame({ cols: 2, rows: 2 }, { cutStyle: 'wavy' }, deps);

        expect(resolveUnsplashImage).toHaveBeenCalled();
    });

    // Pins ordering step 4: the loading overlay gets a paint before
    // generation starts (off-thread when possible; the yield still matters
    // for the synchronous fallback jsdom exercises here).
    it('yields for paint before generation starts', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        const yieldOrder = vi.mocked(yieldForPaint).mock.invocationCallOrder[0];
        const createOrder = vi.mocked(createNewGameAsync).mock.invocationCallOrder[0];
        expect(yieldOrder).toBeLessThan(createOrder);
    });

    it('reports piece-count-mismatch with repro params when generation flags one', async () => {
        // Drive the callback directly rather than constructing a genuinely
        // broken puzzle: the detector itself is covered in generator.test.ts,
        // and what this test owns is the wiring — that the callback is passed,
        // captured, and reported against the state that createNewGameAsync
        // resolved.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGameAsync).mockImplementation(async (imageUrl, imageSize, viewport, grid, options, signal) => {
            options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
            return realCreateNewGameAsync(imageUrl, imageSize, viewport, grid, options, signal);
        });

        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        expect(umamiTrack).toHaveBeenCalledWith('piece-count-mismatch', expect.objectContaining({
            source: 'fresh',
            expected: 4,
            actual: 2,
            baseCut: 'sine',
            cols: 2,
            rows: 2,
        }));
        // The console copy is the only signal on a local `npm run dev`, where
        // `track` is a no-op without a website ID — so it is a tested part of
        // this report, not incidental logging. Asserted against the payload
        // read back out of the tracked call rather than against a second
        // `objectContaining`: two matchers over the same six keys both stay
        // green when `warn` is handed a trimmed copy (no `seed`, no
        // `imageWidth`, no `rotationMode`), which is exactly the
        // paste-into-`__reproPuzzle`-identically property claimed here.
        const tracked = umamiTrack.mock.calls
            .find(([name]) => name === 'piece-count-mismatch')?.[1];
        expect(warnSpy).toHaveBeenCalledWith('[piece-count] repro params', tracked);
    });

    // #512: `__newComposableGame` and other dev-console starts pass 'dev' as
    // the 4th argument so a developer poking at cut parameters doesn't
    // inflate the field-incident count. The wiring that binds 'dev' at the
    // composition root is `bootstrap.test.ts`'s concern; this is the
    // mechanism the binding relies on — that the parameter actually reaches
    // the tracked event.
    it('threads a non-default source through to the mismatch event', async () => {
        // Spied purely to silence it: the branch under test also writes the
        // repro params to the console, and `diagnostics` is enabled under
        // Vitest, so an unstubbed run prints them on every suite run.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGameAsync).mockImplementation(async (imageUrl, imageSize, viewport, grid, options, signal) => {
            options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
            return realCreateNewGameAsync(imageUrl, imageSize, viewport, grid, options, signal);
        });

        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps, 'dev');

        expect(umamiTrack).toHaveBeenCalledWith(
            'piece-count-mismatch',
            expect.objectContaining({ source: 'dev' }),
        );
    });

    it('never reports the image URL on the mismatch event', async () => {
        // Silencing again, as above.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGameAsync).mockImplementation(async (imageUrl, imageSize, viewport, grid, options, signal) => {
            options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
            return realCreateNewGameAsync(imageUrl, imageSize, viewport, grid, options, signal);
        });

        // A player-picked photo, so the state carries a real `https://` URL.
        // A blank puzzle carries no URL at all, which would make the
        // redaction assertion below unfailable.
        vi.mocked(getImageProxyBaseUrl).mockReturnValue('https://proxy.example');
        await startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions({ imageSource: undefined, pickedImage: makeCandidateImage() }),
            deps,
        );
        expect(install.mock.calls.at(-1)?.[0].imageUrl).toContain('https://');

        const call = umamiTrack.mock.calls.find(([name]) => name === 'piece-count-mismatch');
        // Named separately so a missing event fails with "no call found"
        // rather than the opaque "the given combination of arguments
        // (undefined and string) is invalid" `JSON.stringify(undefined)`
        // throws below.
        expect(call).toBeDefined();
        expect(JSON.stringify(call?.[1])).not.toContain('http');
    });

    it('reports nothing for a healthy puzzle', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);
        const names = umamiTrack.mock.calls.map(([name]) => name);
        expect(names).not.toContain('piece-count-mismatch');
    });

    it('stamps generationMode and generationMs on new-game-started', async () => {
        await startNewGame({ cols: 2, rows: 2 }, noTracedTabsOptions(), deps);

        expect(umamiTrack).toHaveBeenCalledWith('new-game-started', expect.objectContaining({
            generationMode: 'sync-fallback', // jsdom has no Worker
            generationMs: expect.any(Number),
        }));
    });

    it('passes onCancel to the overlay only when a game is installed', async () => {
        await startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions(),
            { ...deps, hasCurrentGame: () => true },
        );
        expect(vi.mocked(showLoadingOverlay).mock.calls[0][1]?.onCancel).toBeTypeOf('function');

        vi.mocked(showLoadingOverlay).mockClear();
        await startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions(),
            { ...deps, hasCurrentGame: () => false },
        );
        expect(vi.mocked(showLoadingOverlay).mock.calls[0][1]?.onCancel).toBeUndefined();
    });

    // A cancellation observed by `createNewGameAsync` itself (rather than the
    // earlier synchronous abort check — see the test below for that path)
    // must unwind quietly: no install, no `new-game-started`, the overlay
    // still comes down, and — critically — the current puzzle's pan/zoom is
    // never touched (`resetViewport` now runs after generation resolves,
    // right before install, specifically so a canceled start never reaches
    // it; see the doc comment on `StartNewGameDeps.resetViewport`).
    it('cancel unwinds silently: no install, no new-game-started, overlay hidden', async () => {
        // Make the generation await hang until the test cancels mid-flight,
        // mirroring how the real worker client reacts to an aborted signal.
        vi.mocked(createNewGameAsync).mockImplementation(async (imageUrl, imageSize, viewport, grid, options, signal) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (signal?.aborted) throw new GenerationCanceledError();
            return realCreateNewGameAsync(imageUrl, imageSize, viewport, grid, options, signal);
        });

        const promise = startNewGame(
            { cols: 2, rows: 2 },
            noTracedTabsOptions(),
            { ...deps, hasCurrentGame: () => true },
        );
        const onCancel = vi.mocked(showLoadingOverlay).mock.calls[0][1]!.onCancel!;
        onCancel();

        await expect(promise).resolves.toBeUndefined(); // resolves, does not reject
        expect(install).not.toHaveBeenCalled();
        expect(resetViewport).not.toHaveBeenCalled();
        expect(umamiTrack).not.toHaveBeenCalledWith('new-game-started', expect.anything());
        expect(umamiTrack).toHaveBeenCalledWith('generation-canceled', expect.objectContaining({
            source: 'fresh',
            cutStyle: 'composable',
            cols: 2,
            rows: 2,
            elapsedMs: expect.any(Number),
        }));
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('reports a cancel with the post-transpose grid, matching new-game-started', async () => {
        // Every `PUZZLE_SIZE_OPTIONS` entry is landscape-normalized, and
        // `new-game-started` reports the grid *after* orientation. Reporting
        // the requested grid on the cancel event would file every portrait
        // cancel under a bucket no completed start ever lands in, so "cancel
        // rate by grid" would divide two disjoint populations.
        const container = document.createElement('div');
        Object.defineProperty(container, 'clientWidth', { value: 400 });
        Object.defineProperty(container, 'clientHeight', { value: 800 });

        await startNewGame(
            { cols: 4, rows: 3 },
            noTracedTabsOptions(),
            { ...deps, container, hasCurrentGame: () => true },
            'dev',
        );
        const started = umamiTrack.mock.calls
            .find(([name]) => name === 'new-game-started')![1] as
            { cols: number; rows: number; orientation: string };
        expect(started).toMatchObject({ cols: 3, rows: 4, orientation: 'portrait' });

        umamiTrack.mockClear();
        vi.mocked(showLoadingOverlay).mockClear();
        vi.mocked(createNewGameAsync).mockImplementation(async (_u, _s, _v, _g, _o, signal) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (signal?.aborted) throw new GenerationCanceledError();
            throw new Error('expected the cancel to win');
        });

        const promise = startNewGame(
            { cols: 4, rows: 3 },
            noTracedTabsOptions(),
            { ...deps, container, hasCurrentGame: () => true },
            'dev',
        );
        vi.mocked(showLoadingOverlay).mock.calls[0][1]!.onCancel!();
        await promise;

        expect(umamiTrack).toHaveBeenCalledWith('generation-canceled', expect.objectContaining({
            // Same grid and orientation the completed start above reported,
            // so both are segment filters across the two events rather than
            // a comparison computed per event.
            cols: 3,
            rows: 4,
            orientation: 'portrait',
            // And the real source, not a hardcoded 'fresh': `installDevHooks`
            // ships in production builds, so a developer canceling a
            // `__newComposableGame` start must not read as an impatient
            // player (#512).
            source: 'dev',
        }));
    });

    // Pins the new cancel rule (mirrors the "throws first" ordering test
    // above, but for cancellation rather than a chunk-fetch failure): the
    // abort check sits before the download-report block, so a canceled
    // start never credits a download for a photo it discards. Cancels from
    // inside the awaited image resolution — the last async step before that
    // check — rather than via a fabricated signal, so this exercises the
    // real ordering rather than asserting on a mock.
    it('does not report an Unsplash download when canceled before the download report', async () => {
        vi.mocked(getImageProxyBaseUrl).mockReturnValue('https://proxy.example');
        vi.mocked(resolveUnsplashImage).mockImplementation(async () => {
            // `showLoadingOverlay` already ran synchronously earlier in this
            // same call, so its `onCancel` is on the mock's call record.
            vi.mocked(showLoadingOverlay).mock.calls[0][1]!.onCancel!();
            return {
                imageUrl: 'https://images.unsplash.com/random.jpg',
                imageSize: { width: 400, height: 300 },
                attribution: {
                    photographerName: 'A Photographer',
                    photographerUrl: 'https://unsplash.com/@photographer',
                    photoUrl: 'https://unsplash.com/photos/random',
                },
                downloadLocation: 'https://api.unsplash.com/photos/random/download',
            };
        });

        await startNewGame(
            { cols: 2, rows: 2 },
            { cutStyle: 'wavy' },
            { ...deps, hasCurrentGame: () => true },
        );

        expect(triggerPhotoDownload).not.toHaveBeenCalled();
        expect(umamiTrack).toHaveBeenCalledWith('generation-canceled', expect.objectContaining({
            cutStyle: 'wavy',
        }));
    });
});

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

function makeAsyncGenerationResult(state: GameState = makeGameState()) {
    return { state, generation: { mode: 'sync-fallback' as const, durationMs: 0 } };
}
