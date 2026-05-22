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
