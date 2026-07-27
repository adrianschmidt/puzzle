/**
 * The toolbar: New Game, Gather Pieces, multi-select, marquee, deselect,
 * the 🎨 background-colour control, and Info/Help — the floating controls
 * that sit outside any single feature flow, wired to the session and the
 * collaborators the composition root already owns.
 *
 * DOM order matters here: every one of these controls is absolutely
 * positioned (`src/style.css` places them by explicit `top`/`right`), so
 * keyboard tab order comes from append order alone, not visual position —
 * see `installBackgroundColorControl` below for the resulting constraint.
 *
 * The info modal's Solve button receives `solve` as a dependency instead of
 * looking `window.__solvePuzzle` up at click time — the one sanctioned
 * behavior change in this refactor (see the plan's Global Constraints).
 * `bootstrap` builds its own `solve` closure around `dev-hooks.ts`'s
 * exported `solvePuzzle`, the same function `installDevHooks` calls to
 * build `window.__solvePuzzle` — both call sites run the same code, even
 * though nothing is passed between the two `install*` calls directly.
 */

import type { GameState } from '../model/types.js';
import {
    createNewGameButton,
    createGatherPiecesButton,
    createSelectToolButton,
    createMarqueeToolButton,
    createDeselectButton,
    createInfoButton,
    createInfoModal,
} from '../ui/index.js';
import type { SelectionManager } from '../interaction/selection-manager.js';
import type { GameSession } from './game-session.js';

/** Collaborators {@link installToolbar} cannot own itself. */
export interface InstallToolbarDeps {
    /** Container the floating controls and the info modal attach to. */
    container: HTMLElement;
    session: GameSession;
    selectionManager: SelectionManager;
    /**
     * Gather all groups into a compact layout, zoom to fit, and render —
     * the same closure passed to `startNewGame`/`loadSharedPuzzle` as
     * `fitView`, reused here for the Gather Pieces button.
     */
    fitView: (state: GameState) => void;
    /** Debounced progress save. */
    save: (state: GameState) => void;
    /** Open the New Game dialog. */
    onNewGame: () => void;
    /**
     * Install the 🎨 background-colour control (`installBackgroundColor`,
     * bound by the caller — its handle is needed elsewhere in the
     * composition root, so this module doesn't own or return it). Invoked
     * between the deselect and Info buttons: the on-screen right-hand
     * column stacks New Game → Gather → 🎨 → Info top to bottom
     * (`src/style.css`: 12px/52px/92px/135px), and DOM order has to match
     * that so Tab visits the controls in the same order a sighted user
     * would reach for them.
     */
    installBackgroundColorControl: () => void;
    /**
     * Solve the puzzle — the exact same implementation `installDevHooks`
     * exposes on `window.__solvePuzzle`. Received as a dependency rather
     * than looked up on `window` at click time; see the module doc.
     */
    solve: () => void;
}

/**
 * Install the toolbar: New Game, Gather Pieces, multi-select, marquee,
 * deselect, the background-colour control, and Info/Help — in that DOM
 * order (see the module doc and `installBackgroundColorControl`).
 */
export function installToolbar(deps: InstallToolbarDeps): void {
    const {
        container,
        session,
        selectionManager,
        fitView,
        save,
        onNewGame,
        installBackgroundColorControl,
        solve,
    } = deps;

    createNewGameButton({
        container,
        // Guarded like the other interaction entry points that read the
        // session: these three run synchronously on click, so an unguarded
        // read threw and swallowed the click whenever boot left no game
        // behind — making the New Game dialog, the one place a player can
        // pick a smaller grid or a blank image and escape a failure rooted
        // in their inputs, the one thing they couldn't reach (#488).
        // Reloading just replays the same inputs. Zero counts read as "no
        // progress to lose", so the dialog opens without a confirm, which
        // is correct with nothing on screen.
        isCompleted: () => session.current()?.completed ?? false,
        getGroupCount: () => session.current()?.groups.length ?? 0,
        getPieceCount: () => session.current()?.pieces.length ?? 0,
        onNewGame,
    });

    createGatherPiecesButton({
        container,
        onGatherPieces: () => {
            // The last sibling of the New Game read above: all three of
            // these touch the session synchronously, so the click threw
            // whenever boot left no game behind. There is nothing to
            // gather in that state, so doing nothing is the whole correct
            // behavior.
            const state = session.current();
            if (!state) return;
            fitView(state);
            save(state);
        },
    });

    createSelectToolButton({ container, selectionManager });

    createMarqueeToolButton({ container, selectionManager });

    createDeselectButton({ container, selectionManager });

    installBackgroundColorControl();

    createInfoButton({
        container,
        onShowInfo: () => {
            createInfoModal({
                container,
                getState: () => session.current(),
                state: session.current(),
                onSolve: solve,
            });
        },
    });
}
