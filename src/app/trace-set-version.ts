import type { GameState } from '../model/types.js';

/**
 * Trace-set version of a puzzle, read from whichever per-style config its
 * cut style stores it in.
 *
 * The version survives in the per-style config on the saved state, so
 * resumed Wavy/Triangles/Classic games report it just like fresh ones (where
 * the cached new-game payload carries it). For Classic it doubles as the
 * generator discriminator, separating sine-generated puzzles from legacy
 * ones — which is what makes the heavy-geometry regime attributable on the
 * save events as well as on completion.
 *
 * Gated on `cutStyle` rather than on "whichever config block is present", so
 * a state carrying a stray foreign config block — a crafted share link, a
 * hand-edited save — can't mis-attribute a version to a style that didn't
 * generate with one. `createNewGame` already drops config blocks that don't
 * match the selected style, so on every state this codebase produces the two
 * readings agree; the gate keeps them agreeing structurally.
 */
export function traceSetVersionOf(state: GameState): number | undefined {
    return state.cutStyle === 'triangles'
        ? state.trianglesConfig?.traceSetVersion
        : state.cutStyle === 'wavy'
          ? state.wavyConfig?.traceSetVersion
          : state.cutStyle === 'classic'
            ? state.classicConfig?.traceSetVersion
            : undefined;
}
