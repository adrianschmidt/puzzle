/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the New Game button logic and DOM integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    shouldConfirmNewGame,
    createNewGameButton,
} from './new-game-button.js';

describe('shouldConfirmNewGame', () => {
    it('should not confirm when game is completed', () => {
        expect(shouldConfirmNewGame(true, 1, 48)).toBe(false);
    });

    it('should not confirm when all pieces are still separate (no progress)', () => {
        // 48 groups, 48 pieces — nothing merged yet
        expect(shouldConfirmNewGame(false, 48, 48)).toBe(false);
    });

    it('should confirm when some pieces have been merged', () => {
        // 47 groups, 48 pieces — at least one merge happened
        expect(shouldConfirmNewGame(false, 47, 48)).toBe(true);
    });

    it('should confirm when many pieces are merged', () => {
        expect(shouldConfirmNewGame(false, 10, 48)).toBe(true);
    });

    it('should confirm when only 2 groups remain (almost done)', () => {
        expect(shouldConfirmNewGame(false, 2, 48)).toBe(true);
    });

    it('should not confirm completed game even with 1 group', () => {
        // Completed with all pieces in one group
        expect(shouldConfirmNewGame(true, 1, 48)).toBe(false);
    });
});

describe('createNewGameButton', () => {
    let container: HTMLElement;
    let onNewGame: ReturnType<typeof vi.fn<() => void>>;
    let confirmFn: ReturnType<typeof vi.fn<(message: string) => boolean>>;

    beforeEach(() => {
        container = document.createElement('div');
        onNewGame = vi.fn<() => void>();
        confirmFn = vi.fn<(message: string) => boolean>().mockReturnValue(true);
    });

    function createButton(overrides: {
        isCompleted?: () => boolean;
        getGroupCount?: () => number;
        getPieceCount?: () => number;
    } = {}) {
        return createNewGameButton({
            container,
            isCompleted: overrides.isCompleted ?? (() => false),
            getGroupCount: overrides.getGroupCount ?? (() => 48),
            getPieceCount: overrides.getPieceCount ?? (() => 48),
            onNewGame,
            confirm: confirmFn,
        });
    }

    it('should add a button to the container', () => {
        createButton();

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe('New Game');
    });

    it('should have the correct class name', () => {
        createButton();

        const button = container.querySelector('button');
        expect(button!.className).toBe('new-game-button');
    });

    it('should call onNewGame without confirm when no progress', () => {
        createButton({
            getGroupCount: () => 48,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(confirmFn).not.toHaveBeenCalled();
        expect(onNewGame).toHaveBeenCalledOnce();
    });

    it('should call onNewGame without confirm when game is completed', () => {
        createButton({
            isCompleted: () => true,
            getGroupCount: () => 1,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(confirmFn).not.toHaveBeenCalled();
        expect(onNewGame).toHaveBeenCalledOnce();
    });

    it('should show confirm dialog when game has progress', () => {
        createButton({
            getGroupCount: () => 30,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(confirmFn).toHaveBeenCalledOnce();
        expect(confirmFn).toHaveBeenCalledWith(
            'Start a new game? Your current progress will be lost.',
        );
    });

    it('should call onNewGame when confirm is accepted', () => {
        confirmFn.mockReturnValue(true);

        createButton({
            getGroupCount: () => 30,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(onNewGame).toHaveBeenCalledOnce();
    });

    it('should NOT call onNewGame when confirm is canceled', () => {
        confirmFn.mockReturnValue(false);

        createButton({
            getGroupCount: () => 30,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(onNewGame).not.toHaveBeenCalled();
    });

    it('should remove button on cleanup', () => {
        const cleanup = createButton();

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should not respond to clicks after cleanup', () => {
        const cleanup = createButton({
            getGroupCount: () => 48,
            getPieceCount: () => 48,
        });

        const button = container.querySelector('button')!;
        cleanup();

        // Button was removed, but let's simulate a click on a detached element
        button.click();

        expect(onNewGame).not.toHaveBeenCalled();
    });
});
