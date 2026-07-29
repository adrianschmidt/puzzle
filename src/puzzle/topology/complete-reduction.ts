/**
 * Repair for a silent gap in bezier-js's `reduce()`.
 *
 * `Bezier.intersects(other)` is implemented as
 * `curveintersects(this.reduce(), other.reduce())`, and
 * `curveintersects` only ever pairs off the sub-curves it is handed.
 * So any part of a curve that `reduce()` fails to return is
 * unreachable to intersection: a crossing there is not found late or
 * imprecisely, it is not found at all.
 *
 * And `reduce()` can drop a part. Its second pass walks each
 * extremum-to-extremum piece in 0.01 steps looking for "simple"
 * sub-curves, and bails out when the first step is already not simple
 * (`bezier.js`, `if (abs(t1 - t2) < step) return []`). That `return`
 * sits inside a `forEach` callback, so rather than aborting the
 * reduction as the `[]` suggests, it skips the rest of the callback —
 * including the `if (t1 < 1)` tail-append that would have emitted the
 * piece.
 *
 * It strikes when a curve has an extremum within about one subdivision
 * step of a segment boundary, leaving a sliver that is numerically
 * degenerate at 1% steps. Rare, but load-bearing: #498 was a cut
 * crossing lost inside such a sliver, which left `buildDCEL` without a
 * vertex and merged the four faces around it into one fused 2×2 piece.
 */

import { Bezier } from 'bezier-js';

/**
 * Ignore coverage holes narrower than this in `t` — far less than a
 * floating-point pixel of curve, so they can carry no crossing, and
 * filling one would only feed `pairiteration` degenerate input.
 */
const MIN_GAP_T = 1e-9;

/**
 * `curve.reduce()`, with any `t`-ranges it omitted added back.
 *
 * The returned sub-curves together cover `[0, 1]`, each carrying the
 * `_t1`/`_t2` range `utils.pairiteration` maps hits back through, so
 * the result can go straight to `Bezier.curveintersects`. They arrive
 * in ascending `t` in practice, but nothing here sorts and
 * `curveintersects` pairs all-against-all, so callers must not rely
 * on it.
 *
 * When `reduce()` already covers the curve — the overwhelmingly common
 * case — its array is returned **as-is**, so intersection results stay
 * bit-identical to `intersects()`. That is what keeps the blast radius
 * small: generated geometry is a reproducibility contract for share
 * links and saves, and only a segment whose `reduce()` actually has a
 * coverage gap (0.2–1.7%, across the grids this app generates) can
 * intersect differently at all.
 *
 * Even there the change is additive at the bezier-js level — filling a
 * hole only adds candidate pairings — but not quite neutral at the call
 * site: a hole in the *middle* emits its hits before the later original
 * parts, so `Curve.intersect`'s first-hit-wins dedup can in principle
 * keep a slightly different point for a crossing it already found.
 */
export function completeReduction(curve: Bezier): Bezier[] {
    const parts = curve.reduce();

    const completed: Bezier[] = [];
    let cursor = 0;
    let filled = false;
    for (const part of parts) {
        if (part._t1 > cursor + MIN_GAP_T) {
            completed.push(subCurve(curve, cursor, part._t1));
            filled = true;
        }
        completed.push(part);
        // `Math.max`, so an out-of-order part can't rewind the cursor
        // over `t` an earlier part already covers and have us "fill" it
        // twice. A `NaN` bound poisons the cursor permanently, which is
        // the safe direction: every later comparison is false, so the
        // curve is left as `reduce()` returned it rather than repaired
        // with a NaN-bounded piece that `pairiteration` would never
        // converge on. Both cases are unreachable through a real
        // `reduce()`; the tests reach them by stubbing it.
        cursor = Math.max(cursor, part._t2);
    }
    if (cursor < 1 - MIN_GAP_T) {
        completed.push(subCurve(curve, cursor, 1));
        filled = true;
    }

    // Nothing was inserted, so `completed` holds exactly `parts` —
    // return the original, so the caller gets the very array `reduce()`
    // returned. `completed` was still built on the way here; this saves
    // a second array object, not the allocation.
    return filled ? completed : parts;
}

/**
 * The piece of `curve` over `[t1, t2]`, tagged with that range.
 *
 * `_t1`/`_t2` are what `utils.pairiteration` uses to map a hit back
 * onto the original curve. `Bezier.split` already sets them correctly
 * for the calls made here — it rescales the parent's bounds, and a
 * whole curve is constructed with `_t1 = 0`, `_t2 = 1` — but they are
 * assigned again anyway, as `reduce()` does for its own parts. That
 * keeps the range a property of this function rather than of whatever
 * it was handed, so the day someone splits from a sub-curve the bounds
 * are still absolute.
 */
function subCurve(curve: Bezier, t1: number, t2: number): Bezier {
    // `split(0, 1)` delegates to `split(1).left`, running a whole de
    // Casteljau hull pass (and building a throwaway `right` half) to
    // arrive back at the curve it started from; build it directly.
    const piece = t1 <= MIN_GAP_T && t2 >= 1 - MIN_GAP_T
        ? new Bezier(curve.points)
        : curve.split(t1, t2);
    piece._t1 = t1;
    piece._t2 = t2;
    return piece;
}
