/**
 * Adaptive minimum-area threshold for auto-grouping.
 *
 * Looks at the distribution of piece bounding-box areas and finds the
 * largest multiplicative gap between consecutive sorted areas. If that
 * gap is ≥ `gapRatio` (default 10×), every piece below the gap is
 * treated as a size-class outlier ("junk") and the geometric mean of
 * the two areas straddling the gap is returned as a soft threshold.
 *
 * The result is meant to be combined with an absolute floor at the
 * caller — i.e. `Math.max(absoluteFloor, adaptive ?? 0)`. The absolute
 * floor catches sub-pixel numerical noise even when the distribution
 * is unimodal and no clear gap exists.
 *
 * Why the geometric mean: it sits at the same log-distance from both
 * "junk" and "real" extremes, so a slightly noisier "real" piece (just
 * above the gap) is still safely above the cutoff.
 *
 * Why a ratio guard: on unimodal puzzles where pieces naturally vary
 * by a factor of 2-3×, every consecutive ratio is small and we don't
 * want to absorb anything. Only a true bimodal distribution (junk and
 * real) produces a 10×+ gap. Set the ratio to `Infinity` to disable
 * adaptive thresholding entirely.
 */

/** Default `gapRatio` for {@link adaptiveMinAreaThreshold}. */
export const DEFAULT_MIN_PIECE_AREA_GAP_RATIO = 10;

/**
 * Compute the adaptive auto-group threshold from a list of piece
 * bounding-box areas.
 *
 * Returns:
 *   - `null` if `areas.length < 2` (nothing to compare).
 *   - `null` if every consecutive ratio is below `gapRatio`
 *     (distribution is unimodal — no clear junk-vs-real split).
 *   - The geometric mean of the two areas straddling the largest gap
 *     otherwise. Pieces whose area is below this value are tiny
 *     enough to be considered outliers.
 *
 * Areas that are `<= 0` are skipped when computing ratios (division
 * by zero would yield Infinity). Such pieces sort to the bottom and
 * are still implicitly caught by any absolute floor the caller
 * applies on top.
 */
export function adaptiveMinAreaThreshold(
    areas: number[],
    gapRatio: number = DEFAULT_MIN_PIECE_AREA_GAP_RATIO,
): number | null {
    if (areas.length < 2) return null;

    const sorted = [...areas].sort((a, b) => a - b);
    let bestRatio = 0;
    let bestGapBelow = 0;
    let bestGapAbove = 0;
    for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1];
        const hi = sorted[i];
        if (lo <= 0) continue;
        const r = hi / lo;
        if (r > bestRatio) {
            bestRatio = r;
            bestGapBelow = lo;
            bestGapAbove = hi;
        }
    }
    if (bestRatio < gapRatio) return null;
    return Math.sqrt(bestGapBelow * bestGapAbove);
}
