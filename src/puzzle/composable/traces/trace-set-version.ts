/**
 * Trace-set version (main-chunk constant).
 *
 * The traced tab library is versioned so future revisions (adding, removing,
 * reworking, or reordering traces) don't break the puzzles that existing
 * share-links and saves reproduce. Each released version is a frozen, ordered
 * snapshot resolved by `getTracedTemplates` in the (lazy) traces module; this
 * file holds only the small integer the new-game path and the share-link
 * decoder need, so neither pulls in the heavy trace data.
 *
 * Bump this when you ship a new trace set. Never edit a previously shipped
 * snapshot. See `getTracedTemplates` and project_share_link_prng_contract.
 */
export const CURRENT_TRACE_SET_VERSION = 1;

/**
 * Shared validity predicate for a raw trace-set version. A trace-set version
 * is only meaningful when it is a finite number `>= 1`; anything else (a
 * non-number, NaN/Infinity, or a sub-1 value) is invalid. Fractional values
 * are floored to the integer snapshot they name.
 *
 * Returns the floored version, or `undefined` when invalid. Callers add their
 * own divergent tail: the traced generator defaults an invalid config to v1,
 * while the share-link decoder drops an invalid `wf.tv` (and caps a valid one
 * to CURRENT_TRACE_SET_VERSION). Keeping the core test in one place stops the
 * two from drifting apart.
 */
export function normalizeTraceSetVersion(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}
