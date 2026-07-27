/**
 * Build the two `new-game-started` analytics payloads: one for a freshly
 * generated puzzle (dialog, boot, console hooks), one for a puzzle loaded
 * from a share link. Kept in one file because both readers derive
 * `traceSetVersion` off the generated state the same way — see the comment
 * on that call in `buildFreshGameData`.
 */

import type { GameState, GridSize, Orientation } from '../model/types.js';
import type { NewGameData } from '../analytics/index.js';
import type { CandidateImage } from './unsplash-display-image.js';
import { classifyImageSource, resolveNewGameImageSource } from './classify-image-source.js';
import { traceSetVersionOf } from './trace-set-version.js';

/**
 * Build the `new-game-started` payload for a freshly generated puzzle.
 */
export function buildFreshGameData(opts: {
    state: GameState;
    cutStyle: string;
    rotationMode: 'none' | 'quarter-turn' | 'free';
    orientation: Orientation;
    oriented: GridSize;
    imageSource?: string;
    imageCategory?: string;
    vibrant: boolean;
    pickedImage?: CandidateImage;
    chunkDegraded: boolean;
    bootFallback: boolean;
}): NewGameData {
    const {
        state, cutStyle, rotationMode, orientation, oriented,
        imageSource, imageCategory, vibrant, pickedImage, chunkDegraded, bootFallback,
    } = opts;

    const data: NewGameData = {
        source: 'fresh',
        cutStyle,
        rotationMode,
        orientation,
        cols: oriented.cols,
        rows: oriented.rows,
        pieceCount: state.pieces.length,
        // resolveNewGameImageSource honors the 'first-run' sentinel, which
        // classifyImageSource can't distinguish from a fallback-after-
        // failed-fetch (both reuse the bundled URL).
        imageSource: resolveNewGameImageSource(imageSource, state.imageUrl),
    };
    // Same reader as the shared-link path, so the derivation has one
    // spelling in this file. `createNewGame` stored whichever of the four
    // configs `generatorConfigsForNewGame` (`generator-configs.ts`) emitted
    // for `cutStyle`, so reading it back off the state returns exactly what
    // those configs stamped — including the degraded Classic case, where
    // `classicConfig` is the one deliberately withheld, so the state
    // carries no trace-set version at all.
    const traceSetVersion = traceSetVersionOf(state);
    if (traceSetVersion !== undefined) {
        data.traceSetVersion = traceSetVersion;
    }
    // Only Classic reaches here with a chunk error — for every other style
    // `start-new-game.ts` threw on the `'fail'` outcome before building this
    // payload. Without this flag a degraded game is
    // indistinguishable from genuine pre-upgrade Classic traffic (both
    // are `classic` with no `traceSetVersion`), which is the metric that
    // decides when the legacy generator can be retired.
    if (chunkDegraded) {
        data.tracedChunkDegraded = true;
    }
    // Same bucket, different cause: the boot fallback never fetched the
    // chunk, so it has no failure to record — but its game is legacy
    // geometry too and has to be excludable from that same query.
    if (bootFallback) {
        data.bootFallback = true;
    }
    if (data.imageSource === 'unsplash') {
        data.imageCategory = imageCategory ?? 'any';
        data.vibrant = vibrant;
        data.imagePicked = pickedImage !== undefined;
    }

    return data;
}

/**
 * Build the `new-game-started` payload for a puzzle loaded from a share link.
 */
export function buildSharedGameData(opts: {
    state: GameState;
    includesProgress: boolean;
    recipientHadSavedState: boolean;
    sharedColor: NonNullable<NewGameData['sharedColor']>;
}): NewGameData {
    const { state, includesProgress, recipientHadSavedState, sharedColor } = opts;

    const data: NewGameData = {
        source: 'shared',
        cutStyle: state.cutStyle ?? 'classic',
        rotationMode: state.rotationMode ?? 'none',
        // The link stores the post-transpose grid, so orientation is the
        // taller-than-wide test on it (square grids read as landscape,
        // matching orientGridSize's normalization).
        orientation:
            state.gridSize.rows > state.gridSize.cols ? 'portrait' : 'landscape',
        cols: state.gridSize.cols,
        rows: state.gridSize.rows,
        pieceCount: state.pieces.length,
        imageSource: classifyImageSource(state.imageUrl),
        includesProgress,
        recipientHadSavedState,
        sharedColor,
    };
    // Read off the generated state rather than off the payload: the link's
    // config blocks have already been through `createNewGame`, which keeps
    // only the one matching the selected cut style, so the crafted-link
    // guard is structural instead of restated per style. Present for a
    // traced-tab Wavy link, a Triangles link, or a sine-based Classic
    // link; a legacy (classic-tab) Wavy link — or a pre-upgrade Classic
    // link — carries no version, matching the fresh path.
    const traceSetVersion = traceSetVersionOf(state);
    if (traceSetVersion !== undefined) {
        data.traceSetVersion = traceSetVersion;
    }

    return data;
}
