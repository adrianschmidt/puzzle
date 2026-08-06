/**
 * Shared precision probes for the geometry-quantization invariant (#487).
 *
 * `quantizePieceGeometry` promises that no generated coordinate carries more
 * decimals than `GEOMETRY_PRECISION_DECIMALS`. Two test files assert that —
 * one on the helper, one at the `createNewGame` seam — and both need the same
 * answer to "how many decimals does this number serialize with". These
 * helpers encode the *definition* of the invariant, so a private copy that
 * drifts would let a real regression pass in one file while failing in the
 * other.
 */

/**
 * Decimals in `v`'s shortest round-trip representation — the same digits
 * `JSON.stringify` writes, since both go through `Number.prototype.toString`.
 *
 * Exponential notation is expanded rather than ignored: `String(1e-7)` is
 * `"1e-7"`, which contains no `.` at all, so splitting on `.` alone would
 * report 0 decimals for exactly the near-zero float residue this check exists
 * to catch.
 */
export function decimals(v: number): number {
    const [mantissa, exponent = '0'] = String(v).split('e');
    const [, fraction = ''] = mantissa.split('.');
    return Math.max(0, fraction.length - Number(exponent));
}

export interface PrecisionSample {
    /** Property path from the walked root, e.g. `[3].edges[1].start.x`. */
    path: string;
    value: number;
    decimals: number;
}

/**
 * Deliberately generic rather than a hand-written coordinate list. The
 * invariant is "nothing on this object is finer than N decimals", so a
 * coordinate field added to `Edge` or `Piece` later has to be caught without
 * anyone remembering to extend a helper — a list-driven probe can only ever
 * check the fields the implementation is already known to handle.
 *
 * Strings are skipped: `piece.shape` and `edge.path` are formatted by `fmt`
 * and deliberately not quantized.
 *
 * `Map` and `Set` throw rather than being walked. `Object.entries` reports no
 * entries for either, so walking one silently checks nothing — and the obvious
 * next thing to probe is `state.groups`, whose `PieceGroup.pieces` is a `Map`.
 * Pass `[...map.values()]` when that is what you mean.
 *
 * `path` is reported so a failure names the offending coordinate instead of
 * only its decimal count. Returns a placeholder zero sample when no number
 * carries a fraction, so its `value` need not appear in `root` at all.
 */
export function worstPrecision(root: unknown): PrecisionSample {
    let worst: PrecisionSample = { path: '', value: 0, decimals: 0 };

    const visit = (value: unknown, path: string): void => {
        if (typeof value === 'number') {
            const d = decimals(value);
            if (d > worst.decimals) worst = { path, value, decimals: d };
        } else if (Array.isArray(value)) {
            value.forEach((item, i) => visit(item, `${path}[${i}]`));
        } else if (value instanceof Map || value instanceof Set) {
            const kind = value instanceof Map ? 'Map' : 'Set';
            throw new TypeError(
                `worstPrecision cannot walk a ${kind} (at \`${path || 'the root'}\`): ` +
                'its contents are invisible to Object.entries, so the check would ' +
                'pass without inspecting a single number.',
            );
        } else if (value !== null && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
                visit(item, `${path}.${key}`);
            }
        }
    };

    visit(root, '');
    return worst;
}
