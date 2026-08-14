/**
 * The traced tab library is versioned so future revisions (add/remove/rework/
 * reorder traces) don't break puzzles that existing share-links and saves
 * reproduce. Each version is a frozen ordered snapshot resolved by
 * `getTracedTemplates`; this file holds only the integer the new-game path and
 * share-link decoder need, so neither pulls in the heavy trace data.
 *
 * Bump when shipping a new trace set; never edit a shipped snapshot.
 * See `getTracedTemplates` and project_share_link_prng_contract.
 */
export const CURRENT_TRACE_SET_VERSION = 1;

/**
 * Callers diverge on the tail: the traced generator defaults an invalid config
 * to v1; the share-link decoder drops an invalid `wf.tv` (and caps a valid one
 * to CURRENT_TRACE_SET_VERSION). This shared core keeps the two from drifting.
 */
export function normalizeTraceSetVersion(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}
