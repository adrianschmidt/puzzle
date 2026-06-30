/**
 * Shared grid-dimension bound for the topology layer.
 *
 * Two places need the same cols/rows ceiling, and they must agree:
 *
 *   1. The share-link decoder (`src/sharing/share-link.ts`) clamps the
 *      decoded grid `g` before it reaches any generator, bounding the O(E²)
 *      curve-crossing check against a crafted link with an absurd grid
 *      (e.g. `1e9×1e9`) that would otherwise hang the tab.
 *   2. The generator (`generator.ts`) re-applies the clamp on the cols/rows
 *      it hands each base-cut generator, AFTER spreading the opaque
 *      `baseCutConfig`, so a crafted `cf.bgc.rows`/`cols` smuggled past the
 *      decoder's `g` clamp can't override the real grid dims.
 *
 * Defining {@link MAX_GRID_DIM} and {@link clampGridDim} once here keeps those
 * two enforcement points from drifting: if the decoder bound is ever raised,
 * the generator backstop rises with it instead of silently re-clamping
 * geometry the decoder now permits.
 *
 * The ceiling itself: the UI tops out at 16×12 (192 pieces), so 64 sits
 * generously above every legitimate or dev-console puzzle and is a strict
 * no-op for them — it can never change `cols`/`rows` for a real puzzle, so it
 * cannot alter geometry or PRNG call order for an existing share link or save.
 *
 * Note the generator backstop only overwrites the literal `cols`/`rows`
 * keys. A future base-cut generator that reads its grid size under a
 * different field name would have that field flow through unclamped, so it
 * would need to apply its own bound. See issue #440.
 */
export const MAX_GRID_DIM = 64;

/** Clamp a grid dimension to a positive integer within `[1, MAX_GRID_DIM]`. */
export function clampGridDim(n: number): number {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_GRID_DIM, Math.floor(n)));
}
