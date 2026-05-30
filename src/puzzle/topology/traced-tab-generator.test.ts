import { describe, it, expect } from 'vitest';
import { tracedTabGenerator } from './traced-tab-generator.js';
import { Curve } from './curve.js';
import { createSeededRandom } from '../seeded-random.js';

describe('tracedTabGenerator', () => {
    it('has id "traced"', () => {
        expect(tracedTabGenerator.id).toBe('traced');
    });

    it('produces a curve with the same start and end as the input edge', () => {
        const random = createSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const result = tracedTabGenerator.generate(edge, random, {});
        expect(result).not.toBeNull();
        expect(result!.start.x).toBeCloseTo(edge.start.x);
        expect(result!.start.y).toBeCloseTo(edge.start.y);
        expect(result!.end.x).toBeCloseTo(edge.end.x);
        expect(result!.end.y).toBeCloseTo(edge.end.y);
    });

    it('returns null for edges that are too short', () => {
        const random = createSeededRandom(1);
        const shortEdge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(tracedTabGenerator.generate(shortEdge, random, {})).toBeNull();
    });

    it('consumes 3 outer PRNG calls per successful tab (2 placement + 1 template subSeed)', () => {
        let calls = 0;
        const counting = (): number => {
            calls++;
            return 0.5; // mid-range — always succeeds.
        };
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const result = tracedTabGenerator.generate(edge, counting, {});
        expect(result).not.toBeNull();
        expect(calls).toBe(3);
    });
});

describe('tracedTabGenerator.generateVariants', () => {
    it('first variant equals generate() for the same seed', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const viaGenerate = tracedTabGenerator.generate(edge, createSeededRandom(7), {});
        const iter = tracedTabGenerator.generateVariants!(edge, createSeededRandom(7), {})[Symbol.iterator]();
        const first = iter.next().value as ReturnType<typeof tracedTabGenerator.generate>;
        expect(first).not.toBeNull();
        expect(viaGenerate).not.toBeNull();
        expect(first!.segments).toEqual(viaGenerate!.segments);
    });

    it('consumes exactly 3 outer PRNG calls regardless of variants pulled', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        let calls = 0;
        const counting = () => { calls++; return 0.5; };
        // Drain ALL variants.
        const all = [...tracedTabGenerator.generateVariants!(edge, counting, {})];
        expect(all.length).toBeGreaterThan(1);
        expect(calls).toBe(3);
    });

    it('yields nothing for a too-short edge (no PRNG drawn)', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        let calls = 0;
        const counting = () => { calls++; return 0.5; };
        const all = [...tracedTabGenerator.generateVariants!(edge, counting, {})];
        expect(all).toHaveLength(0);
        expect(calls).toBe(0);
    });

    it('every yielded variant keeps the edge endpoints', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        for (const v of tracedTabGenerator.generateVariants!(edge, createSeededRandom(3), {})) {
            if (!v) continue; // a rung may yield null if its splice fails
            expect(v.start.x).toBeCloseTo(0);
            expect(v.end.x).toBeCloseTo(240);
        }
    });
});
