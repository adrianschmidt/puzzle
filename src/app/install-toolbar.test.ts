/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelectionManager } from '../interaction/selection-manager.js';
import type { GameState } from '../model/types.js';
import type { GameSession } from './game-session.js';
import { installToolbar, type InstallToolbarDeps } from './install-toolbar.js';

/** A `GameSession` fake whose `current()` returns `state` (default: no game). */
function makeSession(state: GameState | undefined = undefined): GameSession {
    return {
        current: () => state,
        hasGame: () => state !== undefined,
        install: vi.fn(),
        restoreSelection: vi.fn(),
    };
}

describe('installToolbar', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.replaceChildren(container);
    });

    afterEach(() => {
        // `reads zero counts and not-completed when there is no game` spies
        // on `window.confirm`; restore it so later tests (in this file, or
        // in whatever order `--sequence.shuffle` picks) don't inherit it.
        vi.restoreAllMocks();
    });

    function deps(overrides: Partial<InstallToolbarDeps> = {}): InstallToolbarDeps {
        return {
            container,
            session: makeSession(),
            selectionManager: new SelectionManager(),
            fitView: vi.fn(),
            save: vi.fn(),
            onNewGame: vi.fn(),
            installBackgroundColorControl: vi.fn(),
            solve: vi.fn(),
            ...overrides,
        };
    }

    it('creates all six toolbar entries in the container', () => {
        installToolbar(deps());
        const selectors = [
            '.new-game-button',
            '.gather-pieces-button',
            '.select-tool-button',
            '.marquee-tool-button',
            '.deselect-button',
            '.info-button',
        ];
        for (const selector of selectors) {
            expect(container.querySelector(selector), selector).not.toBeNull();
        }
    });

    it('keeps the background-colour control between deselect and Info in DOM order', () => {
        // Every one of these controls is absolutely positioned in one
        // visual top-to-bottom stack (src/style.css), so DOM order alone
        // sets keyboard tab order — it has to match New Game -> Gather ->
        // select -> marquee -> deselect -> background-colour -> Info.
        const installBackgroundColorControl = vi.fn(() => {
            const marker = document.createElement('div');
            marker.className = 'background-color-marker';
            container.appendChild(marker);
        });
        installToolbar(deps({ installBackgroundColorControl }));

        const classNames = [...container.children].map((el) => el.className);
        expect(classNames).toEqual([
            'new-game-button',
            'gather-pieces-button',
            'select-tool-button',
            'marquee-tool-button',
            'deselect-button',
            'background-color-marker',
            'info-button',
        ]);
    });

    it('reads zero counts and not-completed when there is no game', () => {
        // Unguarded reads here threw and swallowed the click in exactly the
        // terminal state boot can leave behind (#488), making the one dialog
        // that can escape the failure the one thing unreachable. With no
        // game, `shouldConfirmNewGame(false, 0, 0)` is false, so the click
        // reaches `onNewGame` directly with no confirm prompt.
        const confirmSpy = vi.spyOn(window, 'confirm');
        const onNewGame = vi.fn();
        installToolbar(deps({ session: makeSession(undefined), onNewGame }));

        container.querySelector<HTMLButtonElement>('.new-game-button')!.click();

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(onNewGame).toHaveBeenCalledTimes(1);
    });

    it('does nothing when Gather is tapped with no game', () => {
        // The last sibling of the New Game read above: all three synchronous
        // session reads threw whenever boot left no game behind. There is
        // nothing to gather in that state, so a silent no-op is correct.
        const fitView = vi.fn();
        const save = vi.fn();
        installToolbar(deps({ session: makeSession(undefined), fitView, save }));

        container.querySelector<HTMLButtonElement>('.gather-pieces-button')!.click();

        expect(fitView).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('gathers and saves when Gather is tapped with a game installed', () => {
        // Positive counterpart to the no-op case above: proves the guard
        // isn't just swallowing every click.
        const fitView = vi.fn();
        const save = vi.fn();
        const state = { pieces: [], groups: [] } as unknown as GameState;
        installToolbar(deps({ session: makeSession(state), fitView, save }));

        container.querySelector<HTMLButtonElement>('.gather-pieces-button')!.click();

        expect(fitView).toHaveBeenCalledWith(state);
        expect(save).toHaveBeenCalledWith(state);
    });

    it('wires solve into the info modal Solve button rather than a window lookup', () => {
        const solve = vi.fn();
        installToolbar(deps({ solve }));

        container.querySelector<HTMLButtonElement>('.info-button')!.click();
        const solveBtn = container.querySelector<HTMLButtonElement>('.info-modal-solve-btn');
        expect(solveBtn).not.toBeNull();
        solveBtn!.click();

        expect(solve).toHaveBeenCalledTimes(1);
    });
});
