/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const hide = vi.fn();
vi.mock('../ui/index.js', () => ({ showCompletionOverlay: vi.fn(() => hide) }));

import { showCompletionOverlay } from '../ui/index.js';
import { RotationFocus } from '../interaction/index.js';
import { makeGameState } from '../test-helpers/fixtures.js';
import { createCompletionPresenter } from './completion-presenter.js';

describe('createCompletionPresenter', () => {
    let container: HTMLElement;
    let rotationFocus: RotationFocus;

    beforeEach(() => {
        vi.mocked(showCompletionOverlay).mockClear();
        hide.mockClear();
        container = document.createElement('div');
        rotationFocus = new RotationFocus();
    });

    it('clears rotation focus before showing, so rotate buttons fade out first', () => {
        // Without this the buttons linger in front of the celebratory zoom.
        rotationFocus.setFocus(3);
        const presenter = createCompletionPresenter({ container, rotationFocus });

        presenter.show(makeGameState());

        expect(rotationFocus.focusedGroupId).toBeNull();
        expect(showCompletionOverlay).toHaveBeenCalledTimes(1);
    });

    it('ignores a second show while one overlay is up', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());
        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(1);
    });

    it('hides on remove and allows showing again afterwards', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());
        presenter.remove();
        expect(hide).toHaveBeenCalledTimes(1);

        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(2);
    });

    it('remove is a no-op when no overlay is up', () => {
        createCompletionPresenter({ container, rotationFocus }).remove();
        expect(hide).not.toHaveBeenCalled();
    });

    it('clears its handle when the user dismisses the overlay', () => {
        const presenter = createCompletionPresenter({ container, rotationFocus });
        presenter.show(makeGameState());

        const onDismiss = vi.mocked(showCompletionOverlay).mock.calls[0][0].onDismiss!;
        onDismiss();

        // Dismiss only clears the handle; the overlay already tore itself
        // down, so calling hide here would be wrong (that's remove()'s job).
        expect(hide).not.toHaveBeenCalled();

        presenter.show(makeGameState());
        expect(showCompletionOverlay).toHaveBeenCalledTimes(2);
    });
});
