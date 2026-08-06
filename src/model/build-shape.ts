/**
 * Lives in the model layer (not the puzzle layer) because persistence also
 * needs it: the serializer omits `piece.shape` from the geometry blob when
 * this function reproduces it byte-identically from the edge paths, and the
 * loader rebuilds it from those paths.
 *
 * "Shared" means shared with persistence, not used by every generator. The
 * composable pipeline (`composable/compose.ts`) calls this function, but
 * `puzzle/procedural-generator.ts` and `puzzle/fractal/convert.ts` each build
 * their own `d` string — the former a single `M …/Z` wrapper around the edge
 * paths, the latter one `M …/Z` per sub-path, inline with the edges. Their
 * output happens to agree with this function today (measured: both styles
 * dedupe fully), and nothing enforces that it keeps agreeing. What makes the
 * dedup safe is not a single builder but the per-piece byte check in
 * `serializePiece`: a shape this function does not reproduce exactly is stored
 * verbatim.
 *
 * ON-DISK CONTRACT (v12+): for every piece whose `shape` was omitted, the
 * bytes emitted here *are* the stored geometry — such a blob is only fully
 * specified together with the reading build's copy of this file. Changing what
 * this function emits (spacing, `Z` placement, `CHAIN_EPSILON`, `fmt`)
 * therefore re-renders every already-saved v12 puzzle, and needs a
 * `STATE_VERSION` bump rather than just an updated unit test. The pinned
 * rebuild fixture in `persistence/serialization.test.ts` is the tripwire.
 */

import type { Edge, Point } from './types.js';

/**
 * The 2-decimal cap is app-wide: every rendered path — `piece.shape`,
 * `edge.path` — comes through here, from the legacy procedural generator, the
 * composable pipeline and the fractal converter alike. It is therefore also
 * the anchor for `GEOMETRY_PRECISION_DECIMALS` (`model/quantize-geometry.ts`),
 * which rounds *stored* coordinates to the precision that can actually reach
 * the screen. Raising the cap here without raising that constant would
 * silently make storage the binding constraint on rendered geometry, so the
 * coupling is pinned by a test alongside this file.
 */
export function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Tolerance for matching consecutive edges' end→start in piece-local px. */
const CHAIN_EPSILON = 0.5;

export function buildShape(edges: Edge[]): string {
    if (edges.length === 0) return '';
    const parts: string[] = [];
    let prevEnd: Point | null = null;
    for (const edge of edges) {
        const continuesChain =
            prevEnd !== null
            && Math.abs(prevEnd.x - edge.start.x) < CHAIN_EPSILON
            && Math.abs(prevEnd.y - edge.start.y) < CHAIN_EPSILON;
        if (!continuesChain) {
            if (parts.length > 0) parts.push('Z');
            parts.push(`M ${fmt(edge.start.x)} ${fmt(edge.start.y)}`);
        }
        parts.push(edge.path);
        prevEnd = edge.end;
    }
    parts.push('Z');
    return parts.join(' ');
}
