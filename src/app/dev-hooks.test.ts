/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState, makeRectPiece, makeSavedGameState } from '../test-helpers/fixtures.js';
import { saveNewPuzzle, loadState } from '../persistence/index.js';
import type { GameState, GridSize, PieceGroup } from '../model/types.js';
import type { GameSession } from './game-session.js';
import type { StartNewGameOptions } from './start-new-game.js';
import type { SharePayload, ReproParams } from '../sharing/index.js';

// The leaf, not the barrel `runWithErrorReport` imports through — mocking it
// still intercepts via the re-export.
vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../ui/toast.js';
import {
    installDevHooks,
    solvePuzzle,
    type DevHooksDeps,
} from './dev-hooks.js';

const HOOK_NAMES = ['__solvePuzzle', '__startVennPuzzle', '__newComposableGame', '__reproPuzzle'] as const;

type WindowHooks = {
    __solvePuzzle: () => void;
    __startVennPuzzle: (overrides?: Record<string, unknown>) => void;
    __newComposableGame: (overrides?: Record<string, unknown>) => void;
    __reproPuzzle: (params: ReproParams) => Promise<boolean>;
};

function hooks(): WindowHooks {
    return window as unknown as WindowHooks;
}

function makeSession(state: GameState | undefined): Pick<GameSession, 'current'> {
    return { current: () => state };
}

function validReproParams(): ReproParams {
    return {
        seed: 42,
        cutStyle: 'classic',
        // Wire sentinel, not a `GameState` value: `ReproParams` is what a
        // developer hand-types.
        imageUrl: 'blank',
        imageSize: { width: 100, height: 100 },
        gridSize: { cols: 2, rows: 2 },
        rotationMode: 'none',
    };
}

describe('solvePuzzle', () => {
    let renderer: FakeRenderer;
    let onSolved: Mock<(state: GameState, group: PieceGroup) => void>;

    beforeEach(() => {
        renderer = createFakeRenderer();
        onSolved = vi.fn();
    });

    it('is a no-op with no game', () => {
        solvePuzzle({ session: makeSession(undefined), renderer, onSolved });
        expect(renderer.renderState).not.toHaveBeenCalled();
        expect(onSolved).not.toHaveBeenCalled();
    });

    it('collapses every piece into a single completed group and celebrates', () => {
        const pieces = [makeRectPiece({ id: 0 }), makeRectPiece({ id: 1, col: 1 })];
        const groups: PieceGroup[] = [
            { id: 0, pieces: new Map([[0, { x: 0, y: 0 }]]), position: { x: 0, y: 0 }, rotation: 0 },
            { id: 1, pieces: new Map([[1, { x: 0, y: 0 }]]), position: { x: 5, y: 5 }, rotation: 0 },
        ];
        const state = makeGameState({ pieces, groups });

        solvePuzzle({ session: makeSession(state), renderer, onSolved });

        expect(state.groups).toHaveLength(1);
        expect(state.completed).toBe(true);
        expect(state.groupsById.size).toBe(1);
        expect(state.pieceToGroup.size).toBe(2);
        expect(renderer.renderState).toHaveBeenCalledWith(state);
        expect(onSolved).toHaveBeenCalledWith(state, state.groups[0]);
    });
});

describe('installDevHooks', () => {
    let start: Mock<(gridSize: GridSize, options: StartNewGameOptions) => Promise<void>>;
    let loadShared: Mock<(payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>>;
    let solve: Mock<() => void>;
    let consoleErrorSpy: MockInstance<typeof console.error>;
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        start = vi.fn(async () => {});
        loadShared = vi.fn(async () => {});
        solve = vi.fn();
        history.replaceState(null, '', '/');
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        vi.mocked(showToast).mockClear();
    });

    afterEach(() => {
        for (const name of HOOK_NAMES) {
            delete (window as unknown as Record<string, unknown>)[name];
        }
        vi.restoreAllMocks();
        delete (window as unknown as { umami?: unknown }).umami;
        localStorage.clear();
    });

    function deps(): DevHooksDeps {
        return { start, loadShared, solve };
    }

    it('installs all four hooks', () => {
        installDevHooks(deps());
        for (const name of HOOK_NAMES) {
            expect(typeof (window as unknown as Record<string, unknown>)[name], name).toBe('function');
        }
    });

    it('exposes the injected solve as __solvePuzzle, not a second binding', () => {
        // The console hook and the Solve button must stay one action: bound
        // once and passed here, nothing left to desync.
        installDevHooks(deps());
        expect(hooks().__solvePuzzle).toBe(solve);

        hooks().__solvePuzzle();
        expect(solve).toHaveBeenCalledTimes(1);
    });

    it('__reproPuzzle resolves false for params the share codec rejects', async () => {
        installDevHooks(deps());
        // Missing `cutStyle`: `reproParamsToPayload` throws before the codec
        // round-trip starts.
        const result = await hooks().__reproPuzzle({ seed: 42 } as ReproParams);
        expect(result).toBe(false);
        expect(loadShared).not.toHaveBeenCalled();
        // Log the error object, not its message, so the console keeps the stack.
        expect(consoleErrorSpy).toHaveBeenCalledWith('[__reproPuzzle]', expect.any(Error));
    });

    it('__reproPuzzle resolves true once the puzzle is on screen', async () => {
        installDevHooks(deps());
        const result = await hooks().__reproPuzzle(validReproParams());
        expect(result).toBe(true);
        expect(loadShared).toHaveBeenCalledTimes(1);
    });

    it('__reproPuzzle reports a generation failure as source=repro, loudly, and toasts', async () => {
        // `source` is arithmetic-load-bearing: operators compute the
        // share-format signal as total `shared-load-failed` minus
        // `source='repro'`, so a mislabeled replay inflates it. The console
        // line is not DEV-gated (a deployed generator failure is what this
        // investigates), and the toast tells the caller the replay went
        // nowhere.
        loadShared.mockRejectedValue(new Error('topology boom'));
        installDevHooks(deps());

        const result = await hooks().__reproPuzzle(validReproParams());

        expect(result).toBe(false);
        expect(umamiTrack).toHaveBeenCalledWith(
            'shared-load-failed',
            { reason: 'topology boom', source: 'repro' },
        );
        expect(consoleErrorSpy)
            .toHaveBeenCalledWith('Failed to load repro puzzle:', expect.any(Error));
        expect(showToast).toHaveBeenCalledWith("Couldn't load repro puzzle");
    });

    it('__reproPuzzle replaces the saved state on a successful replay, but leaves the address bar alone', async () => {
        saveNewPuzzle(makeSavedGameState());
        expect(loadState()).not.toBeUndefined();
        history.replaceState(null, '', '/#p=something');
        // Production's `loadShared` (`loadSharedPuzzle`) persists the new
        // puzzle itself once generation succeeds; the stub models that side
        // effect to exercise "replaced".
        loadShared.mockImplementation(async () => {
            saveNewPuzzle({ ...makeSavedGameState(), imageUrl: 'repro-puzzle.jpg' });
        });

        installDevHooks(deps());
        await hooks().__reproPuzzle(validReproParams());

        // A `#p=` link must stay reloadable after a replay.
        expect(window.location.hash).toBe('#p=something');
        // Previous save replaced by the repro's own — not merely cleared.
        expect(loadState()?.imageUrl).toBe('repro-puzzle.jpg');
        // `recipientHadSavedState` reflects the pre-replace read.
        expect(loadShared).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('__reproPuzzle leaves the previous save intact when the replay is canceled', async () => {
        // Cancel (#489) resolves `loadShared` normally without calling
        // `persistNewPuzzle`, so the previous save must survive. The default
        // no-op stub models that.
        saveNewPuzzle(makeSavedGameState());

        installDevHooks(deps());
        const result = await hooks().__reproPuzzle(validReproParams());

        expect(result).toBe(true);
        expect(loadState()?.imageUrl).toBe('test-image.jpg');
    });

    it('__startVennPuzzle starts a single-cell composable venn puzzle', () => {
        installDevHooks(deps());
        hooks().__startVennPuzzle();
        expect(start).toHaveBeenCalledWith(
            { cols: 1, rows: 1 },
            expect.objectContaining({ cutStyle: 'composable', imageSource: 'blank' }),
        );
    });

    it('__newComposableGame defaults to an 8x6 composable grid', () => {
        installDevHooks(deps());
        hooks().__newComposableGame();
        expect(start).toHaveBeenCalledWith(
            { cols: 8, rows: 6 },
            expect.objectContaining({ cutStyle: 'composable' }),
        );
    });
});
