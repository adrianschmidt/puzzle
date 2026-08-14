/**
 * Shared precision probes for the geometry-quantization invariant (#487). Two
 * test files assert it — one on the helper, one at the `createNewGame` seam —
 * and both need the same "how many decimals does this number serialize with".
 * A private copy that drifted would let a regression pass in one, fail in the
 * other.
 */

/**
 * Decimals in `v`'s shortest round-trip representation — the digits
 * `JSON.stringify` writes. Exponential notation is expanded, not ignored:
 * `String(1e-7)` is `"1e-7"` with no `.`, so splitting on `.` alone would
 * report 0 decimals for exactly the near-zero residue this catches.
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
 * Deliberately generic, not a hand-written coordinate list: a field added to
 * Edge/Piece later is caught without anyone remembering to extend a helper.
 * Strings are skipped (`piece.shape`, `edge.path` are formatted, not
 * quantized). Map and Set throw rather than walk — Object.entries reports no
 * entries, so walking one checks nothing (the next probe target, state.groups,
 * holds a Map); pass `[...map.values()]`. `path` names the offending
 * coordinate on failure; a zero sample is returned when nothing carries a
 * fraction.
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
