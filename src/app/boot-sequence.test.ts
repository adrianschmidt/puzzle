/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('../ui/loading-overlay.js', () => ({
    showLoadingOverlay: vi.fn(),
    hideLoadingOverlay: vi.fn(),
}));

import { hideLoadingOverlay } from '../ui/loading-overlay.js';
import { ViewportTransform } from '../interaction/index.js';
import { makeSavedGameState } from '../test-helpers/fixtures.js';
import { saveNewPuzzle, STORAGE_KEY } from '../persistence/index.js';
import { saveCutStylePreference } from '../game/cut-styles.js';
import { saveComposableConfigPreference } from '../game/composable-config.js';
import { saveFractalConfigPreference } from '../game/fractal-config.js';
import { saveWavyConfigPreference } from '../game/wavy-config.js';
import { saveImageSourcePreference } from '../game/image-source.js';
import { saveImageCategoryPreference, saveVibrantPreference } from '../game/image-categories.js';
import { saveRotationEnabledPreference } from '../ui/index.js';
import type { GameState, GridSize } from '../model/types.js';
import { runBootSequence, type BootSequenceDeps } from './boot-sequence.js';
import type { StartNewGameOptions } from './start-new-game.js';

/** Click the corrupt-save dialog's "Start new game" button. */
function dismissCorruptSaveDialog(container: HTMLElement): void {
    const btn = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.corrupt-save-btn'),
    ).find((b) => b.textContent === 'Start new game')!;
    btn.click();
}

/**
 * `runBootSequence` awaits `tryLoadShared()` before anything else, and even
 * a mock async function that "resolves immediately" still defers past that
 * await via the microtask queue — so state right after calling (not
 * awaiting) `runBootSequence` proves nothing. This polls a real condition
 * (never a fixed tick count) until it holds, so it advances exactly as far
 * as the step under test requires and no further.
 */
async function flushUntil(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 50; i++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('flushUntil: condition never became true');
}

describe('runBootSequence', () => {
    let umamiTrack: ReturnType<typeof vi.fn>;
    let install: Mock<(state: GameState) => void>;
    let restoreSelection: Mock<(saved: readonly number[]) => void>;
    let start: Mock<(gridSize: GridSize, options: StartNewGameOptions) => Promise<void>>;
    let hasGame: boolean;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        install = vi.fn();
        restoreSelection = vi.fn();
        start = vi.fn(async () => { hasGame = true; });
        hasGame = false;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    function deps(overrides: Partial<BootSequenceDeps> = {}): BootSequenceDeps {
        return {
            container: document.createElement('div'),
            session: { install, restoreSelection, hasGame: () => hasGame },
            viewportTransform: new ViewportTransform(),
            applyTransform: vi.fn(),
            tryLoadShared: vi.fn(async () => false),
            isRescueReloadPending: () => false,
            start,
            ...overrides,
        };
    }

    it('stops after a share link handled the boot, even with a readable save waiting', async () => {
        // A save alone would `install`; seeding one and still asserting
        // `install` was never called is what actually pins share > saved —
        // without it, this test would pass even if saved-game handling ran
        // first and just happened to find nothing to install.
        saveNewPuzzle(makeSavedGameState(), [0]);
        const d = deps({ tryLoadShared: vi.fn(async () => true) });
        await runBootSequence(d);
        expect(start).not.toHaveBeenCalled();
        expect(install).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('starts a fresh puzzle when there is no save', async () => {
        await runBootSequence(deps());
        expect(start).toHaveBeenCalledTimes(1);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('marks a brand-new visitor as first-run', async () => {
        // A visitor with no save and no touched image preference gets the
        // hand-picked bundled image, not a random one.
        await runBootSequence(deps());
        expect(start.mock.calls[0][1].imageSource).toBe('first-run');
        expect(console.error).not.toHaveBeenCalled();
    });

    it('is not first-run when an image-source preference exists, even with no save', async () => {
        saveImageSourcePreference('unsplash');
        await runBootSequence(deps());
        // The concrete preference value, not just "isn't the sentinel" —
        // `not.toBe('first-run')` would pass for `undefined` too and prove
        // nothing about the preference actually being read.
        expect(start.mock.calls[0][1].imageSource).toBe('unsplash');
        expect(console.error).not.toHaveBeenCalled();
    });

    it('is not first-run when an image-category preference exists, even with no save', async () => {
        saveImageCategoryPreference('nature');
        await runBootSequence(deps());
        // No image-source preference was saved, so the concrete non-first-run
        // reading is `undefined` (unset), not the 'first-run' sentinel.
        expect(start.mock.calls[0][1].imageSource).toBeUndefined();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('hides the loading overlay when boot finishes', async () => {
        await runBootSequence(deps());
        expect(hideLoadingOverlay).toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('leaves the overlay up when a rescue reload is pending', async () => {
        // Otherwise the page flashes blank for the gap before the reload lands.
        await runBootSequence(deps({
            tryLoadShared: vi.fn(async () => true),
            isRescueReloadPending: () => true,
        }));
        expect(hideLoadingOverlay).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it('substitutes a Classic puzzle when the preferred start fails', async () => {
        const failing = vi.fn()
            .mockRejectedValueOnce(new Error('chunk boom'))
            .mockImplementationOnce(async () => { hasGame = true; });
        await runBootSequence(deps({ start: failing }));
        expect(failing).toHaveBeenCalledTimes(2);
        expect(failing.mock.calls[1][1].bootFallback).toBe(true);
    });

    it('drops the per-style configs but keeps size, image, vibrancy and rotation in the fallback', async () => {
        // Seed every per-style preference the fallback must NOT forward,
        // plus the ones it must.
        saveCutStylePreference('fractal');
        saveFractalConfigPreference({ borderless: true });
        saveWavyConfigPreference({ borderless: true });
        saveImageSourcePreference('blank');
        saveImageCategoryPreference('nature');
        saveVibrantPreference(true);
        saveRotationEnabledPreference(true);

        const failing = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockImplementationOnce(async () => { hasGame = true; });
        await runBootSequence(deps({ start: failing }));

        // The contrast case: the *preferred* start must still carry the
        // per-style configs (and the cut style itself) — without this, an
        // implementation that dropped them from both calls would also pass.
        const preferredOptions = failing.mock.calls[0][1];
        expect(preferredOptions).toEqual({
            cutStyle: 'fractal',
            composableConfig: undefined,
            imageSource: 'blank',
            imageCategory: 'nature',
            fractalConfig: { borderless: true },
            wavyConfig: { borderless: true },
            vibrant: true,
            rotationEnabled: true,
        });

        const fallbackOptions = failing.mock.calls[1][1];
        expect(fallbackOptions).toEqual({
            bootFallback: true,
            imageSource: 'blank',
            imageCategory: 'nature',
            vibrant: true,
            rotationEnabled: true,
        });

        // Same grid size on both attempts — the fallback keeps the size,
        // it doesn't drop or resize it.
        expect(failing.mock.calls[1][0]).toEqual(failing.mock.calls[0][0]);
    });

    it('converts a composable slider preference into the generator config for the preferred start', async () => {
        saveCutStylePreference('composable');
        saveComposableConfigPreference({
            baseCut: 'sine',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.3,
            verticalFrequency: 2,
            tabGenerator: 'classic',
            borderless: true,
            jitter: 0.15,
            smooth: false,
        });
        await runBootSequence(deps());
        expect(start.mock.calls[0][1].composableConfig).toEqual({
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.2, hf: 1.5, va: 0.3, vf: 2 },
            tabGenerator: 'classic',
            tabConfig: {},
            borderless: true,
        });
    });

    it('does not convert a stale composable preference when the cut style is not composable', async () => {
        // A player who tried Composable once, then switched to Fractal,
        // still has a composable slider preference sitting in storage. It
        // must not leak into a Fractal start.
        saveCutStylePreference('fractal');
        saveComposableConfigPreference({
            baseCut: 'sine',
            horizontalAmplitude: 0.2,
            horizontalFrequency: 1.5,
            verticalAmplitude: 0.3,
            verticalFrequency: 2,
            tabGenerator: 'classic',
            borderless: true,
            jitter: 0.15,
            smooth: false,
        });
        await runBootSequence(deps());
        expect(start.mock.calls[0][1].composableConfig).toBeUndefined();
        expect(console.error).not.toHaveBeenCalled();
    });

    describe('a readable saved game', () => {
        it('installs the state and restores the selection', async () => {
            saveNewPuzzle(makeSavedGameState(), [0]);
            await runBootSequence(deps());
            expect(install).toHaveBeenCalledWith(
                expect.objectContaining({ imageUrl: 'test-image.jpg' }),
            );
            expect(restoreSelection).toHaveBeenCalledWith([0]);
            expect(start).not.toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();
        });

        it('applies a saved viewport', async () => {
            saveNewPuzzle(makeSavedGameState(), [], { scale: 2, offset: { x: 10, y: 20 } });
            const d = deps();
            await runBootSequence(d);
            expect(d.viewportTransform.getState()).toEqual({ scale: 2, offset: { x: 10, y: 20 } });
            expect(d.applyTransform).toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();
        });

        it('keeps the default view for a pre-feature save with no viewport', async () => {
            saveNewPuzzle(makeSavedGameState(), []);
            const d = deps();
            await runBootSequence(d);
            expect(d.viewportTransform.getState()).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
            expect(d.applyTransform).not.toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();
        });
    });

    describe('an unreadable saved game', () => {
        beforeEach(() => {
            localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
        });

        it('reports save-unreadable, hides the overlay, and opens the corrupt-save dialog', async () => {
            const d = deps();
            const promise = runBootSequence(d);
            await flushUntil(() => d.container.querySelector('.corrupt-save-dialog') !== null);

            expect(umamiTrack).toHaveBeenCalledWith(
                'save-unreadable',
                expect.objectContaining({ reason: 'parse-error' }),
            );
            expect(hideLoadingOverlay).toHaveBeenCalled();
            expect(console.error).not.toHaveBeenCalled();

            dismissCorruptSaveDialog(d.container);
            await promise;
        });

        it('does not start a fresh puzzle while the dialog is open, only after it is dismissed', async () => {
            const d = deps();
            const promise = runBootSequence(d);
            await flushUntil(() => d.container.querySelector('.corrupt-save-dialog') !== null);

            // The dialog is up and the fresh start must not have run yet.
            expect(start).not.toHaveBeenCalled();

            dismissCorruptSaveDialog(d.container);
            await promise;

            expect(start).toHaveBeenCalledTimes(1);
            expect(console.error).not.toHaveBeenCalled();
        });

        it('reports save-recovery and is not first-run for this returning user', async () => {
            const d = deps();
            const promise = runBootSequence(d);
            await flushUntil(() => d.container.querySelector('.corrupt-save-dialog') !== null);
            dismissCorruptSaveDialog(d.container);
            await promise;

            expect(umamiTrack).toHaveBeenCalledWith(
                'save-recovery',
                expect.objectContaining({ downloaded: false }),
            );
            // A returning user with an unreadable save keeps today's
            // random-image behavior rather than the first-run bundled image.
            // No image-source preference was saved in this test, so the
            // concrete non-first-run reading is `undefined` (unset).
            expect(start.mock.calls[0][1].imageSource).toBeUndefined();
            expect(console.error).not.toHaveBeenCalled();
        });
    });
});
