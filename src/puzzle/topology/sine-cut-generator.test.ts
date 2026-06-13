import { describe, it, expect } from 'vitest';
import { sineCutGenerator } from './sine-cut-generator.js';

describe('sineCutGenerator', () => {
    it('has id "sine"', () => {
        expect(sineCutGenerator.id).toBe('sine');
    });

    it('produces 4 border curves followed by internal cuts', () => {
        const random = makeSeededRandom(42);
        const curves = sineCutGenerator.generate(
            { width: 600, height: 400 },
            random,
            {
                cols: 3, rows: 2,
                ha: 0.1, hf: 1,
                va: 0.1, vf: 1,
            },
        );
        // 4 borders + (rows-1) horizontals + (cols-1) verticals = 4 + 1 + 2 = 7
        expect(curves).toHaveLength(7);
        // Borders are straight lines (1 segment each)
        expect(curves[0].segments).toHaveLength(1);
        expect(curves[1].segments).toHaveLength(1);
        expect(curves[2].segments).toHaveLength(1);
        expect(curves[3].segments).toHaveLength(1);
        // Internal cuts at frequency=1 produce >=4 segments (the curve
        // builder rounds up to multiples of 4)
        expect(curves[4].segments.length).toBeGreaterThanOrEqual(4);
    });

    it('emits straight lines when amplitude or frequency is zero', () => {
        const random = makeSeededRandom(1);
        const curves = sineCutGenerator.generate(
            { width: 100, height: 100 },
            random,
            {
                cols: 2, rows: 2,
                ha: 0, hf: 1,
                va: 1, vf: 0,
            },
        );
        // Border + horizontal + vertical = 4 + 1 + 1 = 6
        // Both internal cuts should be straight lines
        expect(curves[4].segments).toHaveLength(1);
        expect(curves[5].segments).toHaveLength(1);
    });
});

describe('sineCutGenerator capability', () => {
    it('advertises borderless support', () => {
        expect(sineCutGenerator.supportsBorderless).toBe(true);
    });
});

describe('sineCutGenerator borderless oversize', () => {
    const frame = { width: 800, height: 600 };
    // Deterministic PRNG that also counts its calls.
    function countingRandom() {
        let calls = 0;
        const fn = () => { calls++; return 0.5; };
        return { fn, calls: () => calls };
    }

    it('bordered: 2x2 grid → 4 border + 1 + 1 = 6 curves', () => {
        const r = countingRandom();
        const curves = sineCutGenerator.generate(frame, r.fn, { cols: 2, rows: 2, ha: 0, hf: 0, va: 0, vf: 0 });
        expect(curves.length).toBe(6);
    });

    it('borderless: 2x2 grid oversizes to 4x4 → 4 border + 3 + 3 = 10 curves', () => {
        const r = countingRandom();
        const curves = sineCutGenerator.generate(frame, r.fn, { cols: 2, rows: 2, ha: 0, hf: 0, va: 0, vf: 0, borderless: true });
        expect(curves.length).toBe(10);
    });

    it('borderless draws the oversized number of per-cut phase offsets', () => {
        // Phase loops draw (rows+1) + (cols+1) values; borderless uses the
        // oversized rows/cols, so the PRNG draw count must match the +2 grid.
        const bordered = countingRandom();
        sineCutGenerator.generate(frame, bordered.fn, { cols: 2, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1 });
        const borderless = countingRandom();
        sineCutGenerator.generate(frame, borderless.fn, { cols: 2, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1, borderless: true });
        expect(bordered.calls()).toBe(6);   // (2+1)+(2+1)
        expect(borderless.calls()).toBe(10); // (4+1)+(4+1)
    });

    it('bordered draw count is unchanged when borderless is absent (PRNG contract)', () => {
        const r = countingRandom();
        sineCutGenerator.generate(frame, r.fn, { cols: 3, rows: 2, ha: 0.2, hf: 1, va: 0.2, vf: 1 });
        expect(r.calls()).toBe(7); // (2+1)+(3+1)
    });
});

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
