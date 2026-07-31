/**
 * @vitest-environment jsdom
 */

import {
    describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance,
} from 'vitest';
import type { GameState } from '../model/types.js';
import type { SharePayload } from '../sharing/index.js';
import type { BackgroundColorControl } from './install-background-color.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { diagnostics } from '../diagnostics.js';

vi.mock('../ui/index.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ui/index.js')>()),
    showLoadingOverlay: vi.fn(),
    hideLoadingOverlay: vi.fn(),
    yieldForPaint: vi.fn(async () => {}),
    showToast: vi.fn(),
}));
// `createNewGame` below runs for real for a plain Classic payload (no lazy
// chunk needed), and its generator registry imports `tracedTabGeneratorStub`
// from this same module — replacing the whole module (rather than passing
// through the rest via `importOriginal`) would leave the registry without
// it and break that generation.
vi.mock('../puzzle/topology/traced-tab-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../puzzle/topology/traced-tab-loader.js')>();
    return { ...actual, preloadTracedTabGenerator: vi.fn(async () => {}) };
});
// jsdom has no real canvas 2D context (`getContext('2d')` returns null), so
// the real `createBlankImageDataUrl` throws in this environment regardless
// of what it's asked to draw — stub it rather than fight the DOM.
vi.mock('./blank-canvas.js', () => ({
    createBlankImageDataUrl: vi.fn(() => 'data:image/png;base64,blank'),
}));
// Plain `vi.spyOn` can't intercept the call `load-shared-puzzle.ts` makes to
// `createNewGame` imported from another module under Vite; wrap the real
// implementation via `vi.mock` passthrough so tests can override it for
// payloads the real generator can't handle in this file (traced-tab styles),
// while the plain-Classic tests still exercise real generation.
vi.mock('../game/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../game/index.js')>();
    return { ...actual, createNewGame: vi.fn(actual.createNewGame) };
});

import { showToast } from '../ui/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { createBlankImageDataUrl } from './blank-canvas.js';
import { createNewGame } from '../game/index.js';
import { loadSharedPuzzle, type LoadSharedPuzzleDeps } from './load-shared-puzzle.js';

/**
 * The real generation logic the `../game/index.js` mock above wraps,
 * captured once so `beforeEach` can restore it explicitly. `vi.clearAllMocks()`
 * only clears call records, not a `mockReturnValue`/`mockImplementation`
 * override a single test set — without this restore, a stub installed by
 * one test would silently leak into every test declared after it.
 */
const realCreateNewGame = vi.mocked(createNewGame).getMockImplementation()!;

/**
 * Minimal decoded payload, matching the base literal used across
 * `src/sharing/share-link.test.ts` (its `base` const in the "attribution
 * scheme validation" describe block) and reused the same way by
 * `share-payload-to-init.test.ts`: the required fields `{ v, i, is, g, c, s,
 * r }` with no optional blocks, cut style forced to plain Classic so real
 * generation never needs the traced-tab chunk this file doesn't register.
 * Callers override the fields each test cares about.
 */
function payload(overrides: Partial<SharePayload> = {}): SharePayload {
    return {
        v: 1,
        i: 'https://images.unsplash.com/photo-123?w=1080',
        is: [1080, 720],
        g: [8, 6],
        c: 'classic',
        s: 12345,
        r: 'none',
        ...overrides,
    };
}

describe('loadSharedPuzzle', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let install: Mock<(state: GameState) => void>;
    let fitView: Mock<(state: GameState) => void>;
    let persistNewPuzzle: Mock<(state: GameState) => void>;
    let onGameAnalytics: Mock<(data: unknown) => void>;
    let adopt: Mock<BackgroundColorControl['adopt']>;
    let deps: LoadSharedPuzzleDeps;
    /**
     * Installed by the tests that reach the piece-count-mismatch branch, and
     * restored one by one rather than through `vi.restoreAllMocks()`:
     * `vite.config.ts` sets no `restoreMocks`, and a blanket restore here would
     * also strip the implementations the `vi.mock` factories above installed.
     */
    let warnSpy: MockInstance<typeof diagnostics.warn> | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(preloadTracedTabGenerator).mockResolvedValue(undefined);
        vi.mocked(createNewGame).mockImplementation(realCreateNewGame);

        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };

        install = vi.fn();
        fitView = vi.fn();
        persistNewPuzzle = vi.fn();
        onGameAnalytics = vi.fn();
        adopt = vi.fn();
        deps = {
            container: document.createElement('div'),
            session: { install },
            fitView,
            persistNewPuzzle,
            backgroundColor: { adopt },
            onGameAnalytics,
        };
    });

    afterEach(() => {
        warnSpy?.mockRestore();
        warnSpy = undefined;
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it('installs the shared puzzle, fits the view and persists it', async () => {
        await loadSharedPuzzle(payload(), false, deps);

        expect(install).toHaveBeenCalledTimes(1);
        const installedState = install.mock.calls[0][0];
        expect(fitView).toHaveBeenCalledWith(installedState);
        expect(persistNewPuzzle).toHaveBeenCalledWith(installedState);
    });

    it('preloads the traced chunk only when the payload needs it', async () => {
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        // A plain Classic link must not pay a chunk fetch.
        await loadSharedPuzzle(payload({ c: 'classic' }), false, deps);
        expect(preloadTracedTabGenerator).not.toHaveBeenCalled();

        // Triangles always needs the traced-tab chunk.
        await loadSharedPuzzle(payload({ c: 'triangles', tf: { tv: 3 } }), false, deps);
        expect(preloadTracedTabGenerator).toHaveBeenCalledTimes(1);
    });

    it('regenerates the blank canvas at the recorded dimensions', async () => {
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await loadSharedPuzzle(payload({ i: 'blank', is: [777, 555] }), false, deps);

        expect(createBlankImageDataUrl).toHaveBeenCalledWith({ width: 777, height: 555 });
        expect(createNewGame).toHaveBeenCalledWith(
            'data:image/png;base64,blank',
            { width: 777, height: 555 },
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
    });

    it('applies the attribution the link carried', async () => {
        await loadSharedPuzzle(payload({
            a: { n: 'A Photographer', u: 'https://unsplash.com/@photographer', p: 'https://unsplash.com/photos/abc123' },
        }), false, deps);

        const installedState = install.mock.calls[0][0];
        expect(installedState.attribution).toEqual({
            photographerName: 'A Photographer',
            photographerUrl: 'https://unsplash.com/@photographer',
            photoUrl: 'https://unsplash.com/photos/abc123',
        });
    });

    it('toasts when progress in the link could not be applied', async () => {
        // A single-id merge entry is structurally invalid (a merge needs at
        // least two pieces), so `applyProgress` rejects it deterministically
        // regardless of the generated puzzle's actual geometry.
        await loadSharedPuzzle(payload({ pr: { m: [[1]] } }), false, deps);

        expect(showToast).toHaveBeenCalledWith("Couldn't load progress — starting from scratch");
        // The puzzle still loads despite the rejected progress.
        expect(install).toHaveBeenCalledTimes(1);
    });

    it('reports new-game-started with source shared and recipientHadSavedState', async () => {
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await loadSharedPuzzle(payload({ pr: { m: [] } }), true, deps);

        const expected = expect.objectContaining({
            source: 'shared',
            recipientHadSavedState: true,
            includesProgress: true,
        });
        expect(onGameAnalytics).toHaveBeenCalledWith(expected);
        expect(umamiTrack).toHaveBeenCalledWith('new-game-started', expected);
    });

    it('reports sharedColor none when the link carried no color', async () => {
        vi.mocked(createNewGame).mockReturnValue(makeGameState());

        await loadSharedPuzzle(payload(), false, deps);

        expect(adopt).not.toHaveBeenCalled();
        expect(onGameAnalytics).toHaveBeenCalledWith(
            expect.objectContaining({ sharedColor: 'none' }),
        );
    });

    it('adopts a shared background color and reports the outcome', async () => {
        vi.mocked(createNewGame).mockReturnValue(makeGameState());
        // 'invalid' rather than 'adopted': proves the reported outcome is
        // whatever `adopt` returns, not a value `loadSharedPuzzle` assumes.
        adopt.mockReturnValue('invalid');

        await loadSharedPuzzle(payload({ bgc: 'indigo-darker' }), false, deps);

        expect(adopt).toHaveBeenCalledWith('indigo-darker');
        expect(onGameAnalytics).toHaveBeenCalledWith(
            expect.objectContaining({ sharedColor: 'invalid' }),
        );
    });

    it('hides the loading overlay even when generation throws', async () => {
        vi.mocked(createNewGame).mockImplementation(() => {
            throw new Error('generation boom');
        });
        const { hideLoadingOverlay } = await import('../ui/index.js');

        await expect(loadSharedPuzzle(payload(), false, deps)).rejects.toThrow('generation boom');
        expect(hideLoadingOverlay).toHaveBeenCalled();
    });

    it('reports piece-count-mismatch with repro params when generation flags one', async () => {
        // Drive the callback directly rather than constructing a genuinely
        // broken puzzle: the detector itself is covered in generator.test.ts,
        // and what this test owns is the wiring — that the callback is passed,
        // captured, and reported against the state that createNewGame returned.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGame).mockImplementation((imageUrl, imageSize, viewport, grid, options) => {
            options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
            return realCreateNewGame(imageUrl, imageSize, viewport, grid, options);
        });

        await loadSharedPuzzle(payload(), false, deps);

        expect(umamiTrack).toHaveBeenCalledWith('piece-count-mismatch', expect.objectContaining({
            source: 'shared',
            expected: 4,
            actual: 2,
            baseCut: 'sine',
            cols: 8,
            rows: 6,
        }));
        // The console copy is the only signal on a local `npm run dev`, where
        // `track` is a no-op without a website ID — so it is a tested part of
        // this report, not incidental logging. Spying also silences it: without
        // the stub the real `console.warn` fires on every suite run. Asserted
        // against the payload read back out of the tracked call, so dropping a
        // repro field from the console copy fails here — a second
        // `objectContaining` over the same six keys would not.
        const tracked = umamiTrack.mock.calls
            .find(([name]) => name === 'piece-count-mismatch')?.[1];
        expect(warnSpy).toHaveBeenCalledWith('[piece-count] repro params', tracked);
    });

    it('reports nothing for a healthy shared puzzle', async () => {
        await loadSharedPuzzle(payload(), false, deps);
        const names = umamiTrack.mock.calls.map(([name]) => name);
        expect(names).not.toContain('piece-count-mismatch');
    });

    // Closes the `source: 'repro'` gap (#512): a `__reproPuzzle` replay runs
    // through this same flow, and without an explicit source it would report
    // indistinguishably from a real recipient's `source: 'shared'` — turning
    // a developer's own debugging replays into apparent field incidents.
    it('reports source repro when the caller identifies the load as a repro replay', async () => {
        // Spied purely to silence it; the branch's console copy is asserted
        // once above.
        warnSpy = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        vi.mocked(createNewGame).mockImplementation((imageUrl, imageSize, viewport, grid, options) => {
            options?.onPieceCountMismatch?.({ expected: 4, actual: 2, baseCutId: 'sine' });
            return realCreateNewGame(imageUrl, imageSize, viewport, grid, options);
        });

        await loadSharedPuzzle(payload(), false, deps, 'repro');

        expect(umamiTrack).toHaveBeenCalledWith(
            'piece-count-mismatch',
            expect.objectContaining({ source: 'repro' }),
        );
    });
});
