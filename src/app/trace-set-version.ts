import type { GameState } from '../model/types.js';
import { configKeyForCutStyle } from '../game/cut-style-strategies.js';

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
    const key = configKeyForCutStyle(state.cutStyle);
    const config = key && state[key];
    return config && 'traceSetVersion' in config ? config.traceSetVersion : undefined;
}
