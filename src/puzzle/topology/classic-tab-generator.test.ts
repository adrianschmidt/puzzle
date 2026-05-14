import { describe, it, expect } from 'vitest';
import { classicTabGenerator } from './classic-tab-generator.js';
import { Curve } from './curve.js';

describe('classicTabGenerator', () => {
    it('has id "classic"', () => {
        expect(classicTabGenerator.id).toBe('classic');
    });

    it('produces a [before, tab, after] decomposition whose combined endpoints match the input edge', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {});

        expect(result).not.toBeNull();
        expect(result!).toHaveLength(3);
        const first = result![0];
        const last = result![2];
        expect(first.start.x).toBeCloseTo(edge.start.x, 6);
        expect(first.start.y).toBeCloseTo(edge.start.y, 6);
        expect(last.end.x).toBeCloseTo(edge.end.x, 6);
        expect(last.end.y).toBeCloseTo(edge.end.y, 6);
    });

    it('the middle piece (the tab itself) deviates from the straight chord', () => {
        const random = makeSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = classicTabGenerator.generate(edge, random, {})!;

        // Sample the tab piece (middle of the decomposition) and find
        // the maximum perpendicular displacement.
        const samples = result[1].sample(20);
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

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
