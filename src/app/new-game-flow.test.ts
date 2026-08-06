/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GridSize } from '../model/types.js';
import type { StartNewGameOptions } from './start-new-game.js';

vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));
// Only `createNewGameDialog` is stubbed — everything else (including
// `loadRotationEnabledPreference` / `saveRotationEnabledPreference`, which
// this suite exercises for real against localStorage) passes through.
vi.mock('../ui/index.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ui/index.js')>()),
    createNewGameDialog: vi.fn(),
}));
// `generator-registry.ts` (pulled in transitively via `getBaseCutGenerator`)
// registers `tracedTabGeneratorStub` from this module at import time —
// replacing the whole module rather than passing through the rest would
// leave that registration undefined and throw before any test runs.
vi.mock('../puzzle/topology/traced-tab-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../puzzle/topology/traced-tab-loader.js')>();
    return { ...actual, preloadTracedTabGenerator: vi.fn() };
});

import { showToast } from '../ui/toast.js';
import {
    createNewGameDialog,
    loadRotationEnabledPreference,
    type NewGameSelection,
} from '../ui/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { loadSizePreference } from '../game/puzzle-sizes.js';
import { loadCutStylePreference } from '../game/cut-styles.js';
import { loadComposableConfigPreference } from '../game/composable-config.js';
import { loadFractalConfigPreference } from '../game/fractal-config.js';
import { loadWavyConfigPreference } from '../game/wavy-config.js';
import { loadImageSourcePreference } from '../game/image-source.js';
import { loadImageCategoryPreference, loadVibrantPreference } from '../game/image-categories.js';
import { loadState, saveNewPuzzle } from '../persistence/index.js';
import { makeSavedGameState } from '../test-helpers/fixtures.js';
import { openNewGameDialog } from './new-game-flow.js';

describe('openNewGameDialog', () => {
    let container: HTMLElement;
    let start: Mock<(gridSize: GridSize, options: StartNewGameOptions) => Promise<void>>;
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        vi.mocked(createNewGameDialog).mockClear();
        // `preloadTracedTabGenerator` gets a fresh resolved-by-default stub
        // each test via `mockReset` (not `vi.clearAllMocks()`, which only
        // clears call records and would leave a `mockRejectedValue` from an
        // earlier test bleeding into this one).
        vi.mocked(preloadTracedTabGenerator).mockReset().mockResolvedValue(undefined);
        vi.mocked(showToast).mockClear();

        container = document.createElement('div');
        start = vi.fn(async () => {});

        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
    });

    function open() {
        openNewGameDialog({ container, start });
        return vi.mocked(createNewGameDialog).mock.calls[0][0];
    }

    /**
     * `wavyConfig`/`fractalConfig`/`composableConfig` are omitted by
     * default, mirroring the real dialog: it only fills the one matching
     * the currently-selected cut style.
     */
    function selectWith(overrides: Partial<NewGameSelection> = {}) {
        const opts = open();
        opts.onSelect({
            sizeId: opts.selectedSizeId,
            cutStyleId: 'wavy',
            rotationEnabled: true,
            imageChoice: { kind: 'surprise' },
            imageCategory: 'nature',
            vibrant: true,
            ...overrides,
        });
        return opts;
    }

    it('seeds the dialog from the saved preferences', () => {
        const opts = open();

        expect(opts.selectedSizeId).toBe(loadSizePreference());
        expect(opts.selectedCutStyleId).toBe(loadCutStylePreference());
        expect(opts.savedComposableConfig).toBe(loadComposableConfigPreference());
        expect(opts.savedFractalConfig).toBe(loadFractalConfigPreference());
        expect(opts.savedWavyConfig).toBe(loadWavyConfigPreference());
        expect(opts.savedRotationEnabled).toBe(loadRotationEnabledPreference());
        expect(opts.savedImageCategory).toBe(loadImageCategoryPreference());
        expect(opts.savedVibrant).toBe(loadVibrantPreference());
        // The real sine base-cut generator advertises borderless support.
        expect(opts.composableSupportsBorderless).toBe(true);
    });

    it('persists the chosen size', () => {
        selectWith({ sizeId: '96' });
        expect(loadSizePreference()).toBe('96');
    });

    it('persists the chosen cut style', () => {
        selectWith({ cutStyleId: 'fractal', fractalConfig: { borderless: true } });
        expect(loadCutStylePreference()).toBe('fractal');
    });

    it('persists the composable config when the cut style is composable', () => {
        const composableConfig: NonNullable<NewGameSelection['composableConfig']> = {
            baseCut: 'sine',
            horizontalAmplitude: 0.22,
            horizontalFrequency: 1.7,
            verticalAmplitude: 0.11,
            verticalFrequency: 2.3,
            tabGenerator: 'classic',
            borderless: true,
            jitter: 0.2,
            smooth: true,
        };
        selectWith({ cutStyleId: 'composable', composableConfig });
        expect(loadComposableConfigPreference()).toEqual(composableConfig);
    });

    it('persists the fractal config when the cut style is fractal', () => {
        selectWith({ cutStyleId: 'fractal', fractalConfig: { borderless: true } });
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });

    it('persists the wavy config when the cut style is wavy', () => {
        selectWith({ cutStyleId: 'wavy', wavyConfig: { borderless: true } });
        expect(loadWavyConfigPreference()).toEqual({ borderless: true });
    });

    it('persists the rotation-enabled preference', () => {
        selectWith({ rotationEnabled: true });
        expect(loadRotationEnabledPreference()).toBe(true);
    });

    it('persists the image source as blank when a blank puzzle is chosen', () => {
        // No UI reads this preference anymore, but first-run detection
        // depends on the key existing, and analytics still classifies by
        // it — pinned against the real loader, not just key presence.
        selectWith({ imageChoice: { kind: 'blank' } });
        expect(loadImageSourcePreference()).toBe('blank');
    });

    it('persists the image source as random for a photo or surprise pick', () => {
        selectWith({ imageChoice: { kind: 'surprise' } });
        expect(loadImageSourcePreference()).toBe('random');
    });

    it('persists the chosen image category', () => {
        selectWith({ imageCategory: 'architecture' });
        expect(loadImageCategoryPreference()).toBe('architecture');
    });

    it('persists the vibrant preference', () => {
        selectWith({ vibrant: true });
        expect(loadVibrantPreference()).toBe(true);
    });

    it('leaves the previous save intact when the start is canceled (or throws)', () => {
        // `start` (the real `startNewGame`) only replaces the save once
        // generation has fully succeeded — a cancel (the loading overlay's
        // Cancel affordance, #489, gated on a puzzle already being
        // installed — true for essentially every dialog-started game) or a
        // throw resolves/rejects without ever reaching its own
        // `persistNewPuzzle`. The default `start` stub (a no-op
        // `async () => {}`) models exactly that: it never touches storage.
        saveNewPuzzle(makeSavedGameState());

        selectWith();

        expect(loadState()?.imageUrl).toBe('test-image.jpg');
    });

    it('replaces the previous save once the start actually succeeds', () => {
        // Production's `start` is `startNewGame`, which persists the new
        // puzzle itself (via `persistNewPuzzle`) once generation succeeds —
        // `new-game-flow.ts` no longer clears storage on its own, so the
        // stub has to model that side effect to exercise "replaced" rather
        // than merely "cleared".
        saveNewPuzzle(makeSavedGameState());
        start.mockImplementation(async () => {
            saveNewPuzzle({ ...makeSavedGameState(), imageUrl: 'new-puzzle.jpg' });
        });

        selectWith();

        expect(loadState()?.imageUrl).toBe('new-puzzle.jpg');
    });

    it('starts the game with the chosen size and options', () => {
        selectWith({ sizeId: '96', cutStyleId: 'wavy', wavyConfig: { borderless: true } });

        expect(start).toHaveBeenCalledWith(
            { cols: 12, rows: 8 },
            expect.objectContaining({
                cutStyle: 'wavy',
                rotationEnabled: true,
                vibrant: true,
                imageCategory: 'nature',
                wavyConfig: { borderless: true },
            }),
        );
    });

    it('omits the seed so every dialog game is a fresh random puzzle', () => {
        selectWith();
        expect(start.mock.calls[0][1]).not.toHaveProperty('seed');
    });

    it('passes a picked photo through', () => {
        const photo = {
            imageUrl: 'https://images.example/x.jpg',
            imageSize: { width: 100, height: 200 },
            attribution: { photographerName: 'A', photographerUrl: 'https://x', photoUrl: 'https://y' },
            downloadLocation: 'https://z',
            thumbUrl: 'https://thumb',
        };
        selectWith({ imageChoice: { kind: 'photo', photo } });
        expect(start.mock.calls[0][1].pickedImage).toBe(photo);
    });

    it('translates the composable slider config into a generator config for the start call', () => {
        const composableConfig: NonNullable<NewGameSelection['composableConfig']> = {
            baseCut: 'triangular',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.2,
            verticalFrequency: 1.5,
            tabGenerator: 'none',
            borderless: false,
            jitter: 0.3,
            smooth: true,
        };
        selectWith({ cutStyleId: 'composable', composableConfig });

        expect(start.mock.calls[0][1].composableConfig).toEqual(
            expect.objectContaining({ baseCutGenerator: 'triangular', tabGenerator: 'none' }),
        );
    });

    it('kicks off the traced-tab preload without leaking an unhandled rejection', async () => {
        vi.mocked(preloadTracedTabGenerator).mockReset().mockRejectedValue(new Error('chunk boom'));
        const opts = open();

        // Must not throw synchronously, and must not become an unhandled
        // rejection — the latter fires after this test function returns, so
        // it wouldn't fail this test specifically, but it would fail the run:
        // vitest's process-level handler catches it, and this repo sets no
        // `dangerouslyIgnoreUnhandledErrors` in vite.config.ts.
        expect(() => opts.onPreloadTracedTabs?.()).not.toThrow();
        expect(preloadTracedTabGenerator).toHaveBeenCalledTimes(1);
        // Let the swallowed rejection's microtask settle before the test ends.
        await Promise.resolve();
        await Promise.resolve();
    });

    it('starts silently and reports nothing when the start succeeds', async () => {
        selectWith();
        await vi.waitFor(() => expect(start).toHaveBeenCalled());

        expect(showToast).not.toHaveBeenCalled();
        expect(umamiTrack).not.toHaveBeenCalled();
    });

    it('toasts and reports new-game-failed, attributed to the failing cut style, when the start rejects', async () => {
        start.mockRejectedValue(new Error('chunk boom'));
        selectWith({ cutStyleId: 'wavy', wavyConfig: { borderless: false } });

        await vi.waitFor(() => {
            expect(showToast).toHaveBeenCalledWith("Couldn't start new game");
        });
        expect(umamiTrack).toHaveBeenCalledWith('new-game-failed', {
            reason: 'chunk boom',
            cutStyle: 'wavy',
        });
    });
});
