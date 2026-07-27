/**
 * Presenter for the "Puzzle Complete!" overlay, owning the re-entrancy guard
 * around `showCompletionOverlay`.
 *
 * The overlay's `hide` handle can be cleared two independent ways: the
 * caller invoking `remove()` (e.g. when starting a new game), or the player
 * dismissing the overlay themselves (tap-anywhere). Both must leave the
 * presenter able to show again.
 */

import type { GameState } from '../model/types.js';
import type { RotationFocus } from '../interaction/index.js';
import { showCompletionOverlay } from '../ui/index.js';

export interface CompletionPresenter {
    /** Show the overlay for `state`. No-op while one is already up. */
    show(state: GameState): void;
    /** Hide any visible overlay. */
    remove(): void;
}

/**
 * Create a presenter that shows/hides the completion overlay in `container`,
 * guarding against a second overlay stacking on top of one already shown.
 */
export function createCompletionPresenter(deps: {
    container: HTMLElement;
    rotationFocus: RotationFocus;
}): CompletionPresenter {
    const { container, rotationFocus } = deps;
    let hideCurrent: (() => void) | null = null;

    return {
        show(state: GameState): void {
            if (hideCurrent) return;
            // Clear focus so any visible rotate buttons quick-fade out before the
            // celebratory zoom; without this the buttons would linger in front
            // of (or under) the completion overlay during the animation.
            rotationFocus.clearFocus();
            hideCurrent = showCompletionOverlay({
                container,
                state,
                onDismiss: () => {
                    hideCurrent = null;
                },
            });
        },

        remove(): void {
            hideCurrent?.();
            hideCurrent = null;
        },
    };
}
