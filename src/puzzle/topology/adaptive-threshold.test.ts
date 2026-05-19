import { describe, it, expect } from 'vitest';
import { adaptiveMinAreaThreshold } from './adaptive-threshold.js';

describe('adaptiveMinAreaThreshold', () => {
    it('returns null for an empty list', () => {
        expect(adaptiveMinAreaThreshold([])).toBeNull();
    });

    it('returns null for a single area', () => {
        expect(adaptiveMinAreaThreshold([100])).toBeNull();
    });

    it('returns null when all areas are equal', () => {
        expect(adaptiveMinAreaThreshold([100, 100, 100, 100])).toBeNull();
    });

    it('returns null for a unimodal distribution (ratios all < gapRatio)', () => {
        // Pieces vary by at most 3× — no clean junk-vs-real gap.
        expect(adaptiveMinAreaThreshold([100, 120, 140, 200, 250, 280, 300])).toBeNull();
    });

    it('returns the geometric mean of the gap straddle when the gap is ≥ 10×', () => {
        // 50 → 500 is exactly 10× — qualifies as a gap.
        // Geometric mean of (50, 500) = sqrt(25000) ≈ 158.11.
        const t = adaptiveMinAreaThreshold([10, 20, 50, 500, 600, 700]);
        expect(t).not.toBeNull();
        expect(t!).toBeCloseTo(Math.sqrt(50 * 500), 5);
    });

    it('returns null when the largest gap is just under the ratio (8×)', () => {
        expect(adaptiveMinAreaThreshold([10, 20, 50, 400, 500, 600])).toBeNull();
    });

    it('picks the LARGEST gap when multiple gaps cross the ratio', () => {
        // 5 → 100 = 20× (gap A)
        // 100 → 5000 = 50× (gap B, larger)
        // The threshold should straddle gap B.
        const t = adaptiveMinAreaThreshold([5, 100, 5000, 6000]);
        expect(t).not.toBeNull();
        expect(t!).toBeCloseTo(Math.sqrt(100 * 5000), 5);
    });

    it('honours a custom gapRatio', () => {
        // 50 → 200 = 4× — passes a custom 3× threshold but fails the default 10×.
        expect(adaptiveMinAreaThreshold([50, 200, 220, 250], 10)).toBeNull();
        const t = adaptiveMinAreaThreshold([50, 200, 220, 250], 3);
        expect(t).not.toBeNull();
        expect(t!).toBeCloseTo(Math.sqrt(50 * 200), 5);
    });

    it('returns null when gapRatio is Infinity (adaptive disabled)', () => {
        expect(adaptiveMinAreaThreshold([1, 1000, 1000, 1000], Infinity)).toBeNull();
    });

    it('skips zero-area pieces when computing ratios', () => {
        // A zero-area piece can't form a valid ratio with anything above it
        // (division by zero), but the remaining 50 → 1000 = 20× pair does qualify.
        const t = adaptiveMinAreaThreshold([0, 50, 1000, 1100]);
        expect(t).not.toBeNull();
        expect(t!).toBeCloseTo(Math.sqrt(50 * 1000), 5);
    });

    it('returns the input as-is — does not mutate the caller list', () => {
        const areas = [500, 10, 600, 50];
        adaptiveMinAreaThreshold(areas);
        expect(areas).toEqual([500, 10, 600, 50]);
    });
});
