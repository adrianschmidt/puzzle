/**
 * Shared grid-dimension bound for the topology layer. Two places need the
 * same cols/rows ceiling and must agree:
 *   1. The share-link decoder (`share-link.ts`) clamps the decoded grid `g`
 *      before any generator, bounding the O(E²) curve-crossing check against
 *      a crafted link with an absurd grid that would hang the tab.
 *   2. The generator re-applies the clamp AFTER spreading the opaque
 *      `baseCutConfig`, so a crafted `cf.bgc.rows`/`cols` can't override the
 *      real grid dims.
 *
 * Defining {@link MAX_GRID_DIM}/{@link clampGridDim} once keeps the two points
 * from drifting. The ceiling: the UI tops out at 16×12 (192 pieces), so 64
 * sits above every legitimate puzzle and is a strict no-op — it can't change
 * `cols`/`rows` for a real puzzle, so it can't alter geometry or PRNG order
 * for an existing share link or save.
 *
 * The generator backstop only overwrites the literal `cols`/`rows` keys; a
 * future generator reading its grid size under another field name would need
 * its own bound. See issue #440.
 */
export const MAX_GRID_DIM = 64;

export function clampGridDim(n: number): number {
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_GRID_DIM, Math.floor(n)));
}
