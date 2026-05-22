import { describe, it, expect } from 'vitest';
import { classicTabGenerator } from './classic-tab-generator.js';
import { Curve } from './curve.js';

describe('classicTabGenerator', () => {
    it('has id "classic"', () => {
        expect(classicTabGenerator.id).toBe('classic');
    });

    it('produces a curve with the same start and end as the input edge', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {});

        expect(result).not.toBeNull();
        expect(result!.start.x).toBeCloseTo(edge.start.x, 6);
        expect(result!.start.y).toBeCloseTo(edge.start.y, 6);
        expect(result!.end.x).toBeCloseTo(edge.end.x, 6);
        expect(result!.end.y).toBeCloseTo(edge.end.y, 6);
    });

    it('returns a curve that deviates from a straight line (the tab protrusion)', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {})!;

        // Sample the result and find the maximum perpendicular displacement
        const samples = result.sample(20);
        const maxAbsY = Math.max(...samples.map(p => Math.abs(p.y)));
        expect(maxAbsY).toBeGreaterThan(5); // tab protrudes meaningfully
    });

    it('returns null when the edge is too short for the tab', () => {
        const random = makeSeededRandom(42);
        // The tab template needs ~12% margin on each side; an extremely
        // short edge cannot fit it.
        const edge = Curve.line({ x: 0, y: 0 }, { x: 0.5, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {});
        expect(result).toBeNull();
    });
});

describe('classicTabGenerator (PRNG snapshot)', () => {
    it('produces a deterministic curve for a fixed seed and edge', () => {
        const random = makeSeededRandom(0xC1A551C); // arbitrary, but stable
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });

        const result = classicTabGenerator.generate(edge, random, {});
        expect(result).not.toBeNull();

        // Flatten to numeric arrays so toMatchInlineSnapshot stays readable.
        const points = result!.segments.flatMap(seg =>
            [seg.p0, seg.cp1, seg.cp2, seg.p3]
                .map(p => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000])
        );

        expect(points).toMatchInlineSnapshot(`
          [
            [
              0,
              0,
            ],
            [
              21.803,
              0,
            ],
            [
              43.607,
              0,
            ],
            [
              65.41,
              0,
            ],
            [
              65.41,
              0,
            ],
            [
              72.256,
              -8.075,
            ],
            [
              54.623,
              -24.226,
            ],
            [
              60.734,
              -34.321,
            ],
            [
              60.734,
              -34.321,
            ],
            [
              69.899,
              -48.453,
            ],
            [
              79.064,
              -50.472,
            ],
            [
              88.23,
              -50.472,
            ],
            [
              88.23,
              -50.472,
            ],
            [
              97.395,
              -50.472,
            ],
            [
              106.56,
              -48.453,
            ],
            [
              115.726,
              -34.321,
            ],
            [
              115.726,
              -34.321,
            ],
            [
              121.836,
              -24.226,
            ],
            [
              104.203,
              -8.075,
            ],
            [
              111.049,
              0,
            ],
            [
              111.049,
              0,
            ],
            [
              154.033,
              0,
            ],
            [
              197.016,
              0,
            ],
            [
              240,
              0,
            ],
          ]
        `);
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
