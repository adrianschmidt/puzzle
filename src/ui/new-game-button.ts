/**
 * New Game button — minimal UI for starting a fresh puzzle.
 *
 * Renders a small floating button that, when clicked, confirms
 * with the user if a game is in progress, then triggers a new game.
 */

/**
 * Determine whether the user should be asked to confirm
 * before starting a new game.
 *
 * Confirmation is needed when the current game is in progress:
 * not completed, and at least one merge has happened (fewer
 * groups than total pieces means pieces have been merged).
 */
export function shouldConfirmNewGame(
    completed: boolean,
    groupCount: number,
    pieceCount: number,
): boolean {
    if (completed) {
        return false;
    }

    // If every piece is still in its own group, no progress to lose
    return groupCount < pieceCount;
}

export interface NewGameButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Returns whether the current game is completed. */
    isCompleted: () => boolean;
    /** Returns the number of groups in the current game. */
    getGroupCount: () => number;
    /** Returns the total number of pieces. */
    getPieceCount: () => number;
    /** Called when the user confirms they want a new game. */
    onNewGame: () => void;
    /** Optional: custom confirm function (for testing). Defaults to window.confirm. */
    confirm?: (message: string) => boolean;
}

/**
 * Create and attach the New Game button.
 *
 * Returns a cleanup function that removes the button from the DOM.
 */
export function createNewGameButton(options: NewGameButtonOptions): () => void {
    const {
        container,
        isCompleted,
        getGroupCount,
        getPieceCount,
        onNewGame,
        confirm: confirmFn = (msg: string) => window.confirm(msg),
    } = options;

    const button = document.createElement('button');
    button.className = 'new-game-button';
    button.textContent = 'New Game';
    button.type = 'button';

    function handleClick(): void {
        const needsConfirm = shouldConfirmNewGame(
            isCompleted(),
            getGroupCount(),
            getPieceCount(),
        );

        if (needsConfirm) {
            const confirmed = confirmFn(
                'Start a new game? Your current progress will be lost.',
            );

            if (!confirmed) {
                return;
            }
        }

        onNewGame();
    }

    button.addEventListener('click', handleClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}
