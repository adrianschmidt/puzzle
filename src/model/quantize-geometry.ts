/**
 * Quantize generated piece geometry to a fixed decimal precision.
 *
 * Runs once on the finished `GeneratedPiece[]`, immediately after generation.
 * Every coordinate the puzzle carries — edge endpoints, sampled curve points,
 * the image offset — is rounded to {@link GEOMETRY_PRECISION_DECIMALS}
 * decimals, so a *generated* puzzle's geometry is one set of numbers whether
 * it is held in memory, written to `localStorage`, or regenerated from a
 * share link.
 *
 * The scope is generated geometry. Saves written before this pass existed are
 * deliberately not re-rounded on load, so a `Piece[]` restored from one still
 * carries full-precision coordinates.
 *
 * The point is size: each full-precision double costs ~17 significant digits
 * in JSON, and what the blob keeps — two coordinates per edge, one per piece
 * (`imageOffset`) — all comes through here. Historically the pass earned its
 * keep on `edge.curvePoints`, ~61% of the blob while they were still
 * persisted, taking the largest supported puzzle from ~5.7 MB to ~3.8 MB
 * (#487). v12 stopped persisting them altogether, so the endpoints and offsets
 * are what is left to round directly.
 *
 * Rounding the samples still pays, indirectly: sealing
 * (`model/seal-geometry.ts`) runs immediately after this pass and folds them
 * into each piece's `bounds`, the one derived field the blob does store. Those
 * bounds are therefore a min/max over already-rounded coordinates and inherit
 * the same precision. Running the two passes in the other order would put
 * full-precision numbers back into the blob.
 *
 * Path strings (`piece.shape`, `edge.path`) are deliberately untouched: they
 * are built earlier in the pipeline by `fmt`, which already emits `toFixed(2)`.
 * Running this pass *after* composition — rather than rounding `curvePoints`
 * where they are produced — is what keeps those strings byte-identical, so
 * existing share links reproduce the same rendered geometry as before.
 */

import type { GeneratedEdge, GeneratedPiece, Point } from './types.js';

/**
 * Decimals retained on every stored coordinate.
 *
 * Two independent limits agree on 2:
 *
 * - `fmt` (`model/build-shape.ts`) already truncates every rendered
 *   path to `toFixed(2)`, so precision finer than this cannot reach the screen.
 * - The strictest merge tolerance is `0.133` of the reference piece width
 *   (`ui/merge-tolerance.ts`) — 8.98 px at 16 columns on a 1080 px image. The
 *   ≤0.005 px error introduced here is ~1/1800 of that.
 */
export const GEOMETRY_PRECISION_DECIMALS = 2;

const FACTOR = 10 ** GEOMETRY_PRECISION_DECIMALS;

/**
 * Round a coordinate to {@link GEOMETRY_PRECISION_DECIMALS} decimals.
 *
 * Coordinates are bounded by the image dimensions, far below the magnitude at
 * which `x / FACTOR` stops having a 2-decimal shortest round-trip form — so
 * `JSON.stringify` emits at most two decimals, which is where the size saving
 * comes from.
 *
 * `-0` is folded to `0`: `JSON.stringify` writes it as `"0"`, so leaving it
 * would make in-memory geometry differ from the same geometry read back.
 *
 * A non-finite result is discarded in favour of the input. `value * FACTOR`
 * overflows to `Infinity` above ~1.798e306, which would turn a finite
 * coordinate into one `JSON.stringify` writes as `null` — a value nothing on
 * the load path re-validates. Generated geometry never comes near that
 * magnitude, but the guard keeps the pass from being the step that makes a
 * coordinate unrepresentable. `NaN`/`±Infinity` *inputs* are passed through
 * unchanged for the same reason: this pass rounds coordinates, it is not the
 * place that decides whether a generator may emit a broken one.
 */
function quantize(value: number): number {
    const rounded = Math.round(value * FACTOR) / FACTOR;
    if (!Number.isFinite(rounded)) return value;
    return rounded === 0 ? 0 : rounded;
}

function quantizePoint(point: Point): Point {
    return { x: quantize(point.x), y: quantize(point.y) };
}

function quantizeEdge(edge: GeneratedEdge): GeneratedEdge {
    const quantized: GeneratedEdge = {
        ...edge,
        start: quantizePoint(edge.start),
        end: quantizePoint(edge.end),
    };
    if (edge.curvePoints) {
        quantized.curvePoints = edge.curvePoints.map(quantizePoint);
    }
    return quantized;
}

/**
 * Return a copy of `pieces` with every coordinate rounded to
 * {@link GEOMETRY_PRECISION_DECIMALS} decimals.
 *
 * Pure: the input pieces, edges, and points are left untouched, matching the
 * treat-pieces-as-immutable convention the rest of the model follows.
 */
export function quantizePieceGeometry(pieces: GeneratedPiece[]): GeneratedPiece[] {
    return pieces.map((piece) => ({
        ...piece,
        edges: piece.edges.map(quantizeEdge),
        imageOffset: quantizePoint(piece.imageOffset),
    }));
}
