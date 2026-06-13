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

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
