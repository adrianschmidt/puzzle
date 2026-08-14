import type { GameState } from '../model/types.js';

/**
 * The version survives in the per-style config on the saved state, so resumed
 * Wavy/Triangles/Classic games report it like fresh ones. For Classic it also
 * discriminates sine-generated puzzles from legacy ones.
 *
 * Gated on `cutStyle` rather than "whichever config block is present", so a
 * state with a stray foreign block (a crafted share link, a hand-edited save)
 * can't mis-attribute a version to a style that didn't generate with one.
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
