/**
 * The dev-console `window.__*` hooks: `__solvePuzzle`, `__startVennPuzzle`,
 * `__newComposableGame`, and `__reproPuzzle`. Undocumented in any UI —
 * they're a workflow tool used directly from the browser console, so their
 * names, signatures, return values, and doc comments are load-bearing and
 * must not drift.
 *
 * `solvePuzzle` is exported separately from `installDevHooks` so the
 * composition root can bind it *once* and hand that one reference to both
 * `window.__solvePuzzle` (this module's `solve` dependency) and the info
 * modal's Solve button (`installToolbar`'s `solve`) — the one sanctioned
 * behavior change in this refactor (see the plan's Global Constraints). One
 * binding rather than two identical-looking ones is what makes them
 * impossible to desynchronize by editing either call site.
 */

import type { GameState, GridSize, PieceGroup } from '../model/types.js';
import type { Renderer } from '../renderer/index.js';
import { buildGroupIndexes } from '../model/helpers.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import {
    type SharePayload,
    encodePayload,
    decodePayload,
    reproParamsToPayload,
    type ReproParams,
} from '../sharing/index.js';
import { loadState, clearSavedState } from '../persistence/index.js';
import { loadImageSourcePreference } from '../game/image-source.js';
import {
    loadImageCategoryPreference,
    loadVibrantPreference,
} from '../game/image-categories.js';
import { runWithErrorReport } from './run-with-error-report.js';
import type { StartNewGameOptions } from './start-new-game.js';
import type { GameSession } from './game-session.js';

/** Collaborators {@link solvePuzzle} cannot own itself. */
export interface SolvePuzzleDeps {
    /**
     * Read-only slice of the {@link GameSession}: this solves whatever is
     * installed and never replaces it, so it has no business reaching
     * `install`.
     */
    session: Pick<GameSession, 'current'>;
    renderer: Renderer;
    /** Frame and celebrate a solved puzzle — the completion zoom. */
    onSolved: (state: GameState, group: PieceGroup) => void;
}

/**
 * Solve the puzzle by placing all pieces in their correct positions.
 *
 * A no-op when there is no installed game — mirrors the #488/#499 guards
 * elsewhere: this runs from a user-triggered click (the info modal's Solve
 * button) or a manually-typed console call, either of which can land in the
 * no-game state a failed boot leaves behind.
 */
export function solvePuzzle(deps: SolvePuzzleDeps): void {
    const state = deps.session.current();
    if (!state) return;

    const solvedGroup: PieceGroup = {
        id: 0,
        pieces: new Map(),
        position: { x: 0, y: 0 },
        rotation: 0,
    };

    for (const piece of state.pieces) {
        solvedGroup.pieces.set(piece.id, {
            x: -piece.imageOffset.x,
            y: -piece.imageOffset.y,
        });
    }

    state.groups = [solvedGroup];
    const solvedIndexes = buildGroupIndexes(state.groups);
    state.groupsById = solvedIndexes.groupsById;
    state.pieceToGroup = solvedIndexes.pieceToGroup;
    state.completed = true;
    deps.renderer.renderState(state);

    // Use the same animated zoom as normal completion.
    deps.onSolved(state, solvedGroup);
}

/** Collaborators {@link installDevHooks} cannot own itself. */
export interface DevHooksDeps {
    /** `startNewGame` bound to the composition root's deps. */
    start: (gridSize: GridSize, options: StartNewGameOptions) => Promise<void>;
    /** `loadSharedPuzzle` bound to the composition root's deps. */
    loadShared: (payload: SharePayload, recipientHadSavedState: boolean) => Promise<void>;
    /**
     * Solve the puzzle — `solvePuzzle` bound to the composition root's deps.
     *
     * Injected rather than built here so `window.__solvePuzzle` and the info
     * modal's Solve button (`installToolbar`'s `solve`) are the same
     * reference. While each installer built its own `solvePuzzle` call, an
     * edit to either one's `onSolved` would have silently desynchronized the
     * two — the exact agreement the sanctioned behavior change establishes.
     */
    solve: () => void;
}

/**
 * Install the four dev-console hooks on `window`.
 */
export function installDevHooks(deps: DevHooksDeps): void {
    // Debug helper: solve the puzzle by placing all pieces in their correct
    // positions. The same reference the info modal's Solve button calls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__solvePuzzle = deps.solve;

    /**
     * Dev-console hook for visual smoke-testing the experimental two-circle
     * Venn cut style. Not exposed in any UI. Removed before Plan 2 merges
     * if the cut style isn't promoted to a user-facing option.
     *
     * Usage (in browser dev console):
     *   __startVennPuzzle()
     *   __startVennPuzzle({ leftRadius: 200, rightCenter: { x: 700, y: 360 } })
     *   __startVennPuzzle({ tabs: true })   // classic tabs on the shared arcs
     *
     * Caveat: share-links and reloads don't yet preserve the venn config —
     * only the in-memory render is meaningful. After the page reloads, the
     * autosaved state falls back to sine defaults.
     */
    (window as any).__startVennPuzzle = (overrides?: {
        leftCenter?: { x: number; y: number };
        leftRadius?: number;
        rightCenter?: { x: number; y: number };
        rightRadius?: number;
        tabs?: boolean;
    }) => {
        const baseCutConfig = {
            leftCenter: overrides?.leftCenter ?? { x: 432, y: 360 },
            leftRadius: overrides?.leftRadius ?? 240,
            rightCenter: overrides?.rightCenter ?? { x: 648, y: 360 },
            rightRadius: overrides?.rightRadius ?? 240,
        };
        void deps.start({ cols: 1, rows: 1 }, {
            cutStyle: 'composable',
            composableConfig: {
                baseCutGenerator: 'venn',
                baseCutConfig,
                tabGenerator: overrides?.tabs ? 'classic' : 'none',
                tabConfig: {},
            },
            imageSource: 'blank',
        });
    };

    /**
     * Dev-console hook for launching a Composable puzzle with arbitrary
     * generator parameters. Exposed because Composable is hidden from the
     * production new-game dialog; power users can still reach the full
     * surface via this helper.
     *
     * Usage (browser console):
     *   __newComposableGame()
     *   __newComposableGame({ cols: 12, rows: 8 })
     *   __newComposableGame({
     *       baseCutConfig: { cols: 8, rows: 6, ha: 0.3, hf: 2, va: 0.3, vf: 1.5 },
     *       tabGenerator: 'none',
     *   })
     *   __newComposableGame({ rotation: 'free' })
     *   __newComposableGame({ seed: 1086655870 })   // reproduce a specific puzzle
     *
     * Defaults: 8×6 grid, sine base-cut generator with composable's stock
     * defaults, classic tabs, no rotation, current saved image-source
     * preference. Seed defaults to a fresh random value each call.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__newComposableGame = (overrides?: {
        cols?: number;
        rows?: number;
        baseCutGenerator?: string;
        baseCutConfig?: Record<string, unknown>;
        tabGenerator?: string;
        tabConfig?: Record<string, unknown>;
        minPieceArea?: number;
        rotation?: 'none' | 'free';
        imageSource?: 'random' | 'blank';
        seed?: number;
    }) => {
        const cols = overrides?.cols ?? 8;
        const rows = overrides?.rows ?? 6;
        const baseCutConfig = overrides?.baseCutConfig ?? {
            cols, rows, ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5,
        };
        const config: ComposableConfig = {
            baseCutGenerator: overrides?.baseCutGenerator ?? 'sine',
            baseCutConfig,
            tabGenerator: overrides?.tabGenerator ?? 'classic',
            tabConfig: overrides?.tabConfig ?? {},
        };
        if (overrides?.minPieceArea !== undefined) {
            config.minPieceArea = overrides.minPieceArea;
        }
        const rotation = overrides?.rotation ?? 'none';
        void deps.start({ cols, rows }, {
            cutStyle: 'composable',
            composableConfig: config,
            imageSource: overrides?.imageSource ?? loadImageSourcePreference(),
            imageCategory: loadImageCategoryPreference(),
            vibrant: loadVibrantPreference(),
            rotationEnabled: rotation !== 'none',
            seed: overrides?.seed,
        });
    };

    /**
     * Dev-console hook: regenerate a puzzle from the info modal's
     * "Reproduction parameters" block. Paste the block's JSON verbatim:
     *
     *   __reproPuzzle({
     *       seed: 1534700170,
     *       cutStyle: 'classic',
     *       imageUrl: 'https://images.unsplash.com/...',
     *       imageSize: { width: 1080, height: 1440 },
     *       gridSize: { cols: 12, rows: 16 },
     *       rotationMode: 'free',
     *       classicConfig: { traceSetVersion: 1 },
     *   })
     *
     * The params run through the share codec's validation and clamps and
     * then the share-link load path, so reproduction semantics match a
     * share link exactly. `imageUrl: 'blank'` — or no `imageUrl` at all —
     * renders on the blank canvas at the recorded dimensions; geometry
     * depends on the image's dimensions, not its pixels. Fractional
     * `imageSize` values are floored by the codec's clamps, and attribution
     * and background color are not part of the params, so a replayed
     * Unsplash puzzle loses its credit. Replaces the current game and save
     * without confirmation, but leaves the address bar alone: a `#p=` link
     * stays put — as declining its confirm dialog does — so the original
     * link remains reloadable, and a reload re-offers it. Decline the prompt
     * and the replay survives.
     *
     * Resolves `true` once the puzzle is on screen and `false` on any
     * failure (matching the share-link loader's `tryLoad`), so
     * `await __reproPuzzle(...)` reports the outcome instead of resolving
     * before generation starts.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__reproPuzzle = async (params: ReproParams): Promise<boolean> => {
        let payload: SharePayload;
        let decoded: SharePayload | null;
        try {
            payload = reproParamsToPayload(params);
            decoded = decodePayload(encodePayload(payload));
        } catch (err) {
            // The error object rather than its message, so the console keeps the
            // stack and renders it expandable (as `diagnostics.warn` does).
            // eslint-disable-next-line no-console
            console.error('[__reproPuzzle]', err);
            return false;
        }
        if (!decoded) {
            // `decodePayload` returns a bare `null` from any of its shape checks,
            // so which field failed is structurally unavailable here. Echoing the
            // mapped payload is the only way the caller sees the rejected value.
            // The two throwing steps above name the field for every hand-typing
            // mistake they can see (unknown cutStyle/rotationMode; a non-numeric
            // imageSize/gridSize/seed throws from assertPayloadNumbersFinite), so
            // what still reaches this branch is a non-string `imageUrl` or a
            // `composableConfig` the decoder rejects.
            // eslint-disable-next-line no-console
            console.error('[__reproPuzzle] params did not survive share-codec validation', payload);
            return false;
        }
        // Narrowing captured in a const: the async closure below would silently
        // un-narrow if `decoded` ever gained a second assignment.
        const validated = decoded;
        // `!!loadState()` rather than a cheaper key probe, for parity with the
        // share path: `recipientHadSavedState` means "had a *readable* save".
        // The decompress is affordable for a one-shot manual dev action.
        const hadSavedState = !!loadState();
        clearSavedState();
        return runWithErrorReport({
            run: async () => {
                await deps.loadShared(validated, hadSavedState);
                return true;
            },
            warnMessage: 'Failed to load repro puzzle:',
            // A generation failure is the thing this helper exists to
            // investigate, so it has to be readable on a deployed build —
            // `runWithErrorReport`'s default diagnostic is DEV-gated.
            logInProduction: true,
            event: 'shared-load-failed',
            // Not a user-facing share-link failure: a generator failure is often
            // the reason this helper was called at all.
            source: 'repro',
            toastMessage: "Couldn't load repro puzzle",
            fallback: false,
        });
    };
}
