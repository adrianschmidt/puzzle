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
