import { describe, it, expect } from 'vitest';
import { tracedTabTemplate, createTracedTabTemplate } from './tab-shapes-traced.js';
import { TRACED_TEMPLATES } from './traces/index.js';
import { createSeededRandom } from '../seeded-random.js';

describe('tracedTabTemplate', () => {
    it('starts at y=0 and ends at y=0 (after transforms)', () => {
        const random = createSeededRandom(7);
        const path = tracedTabTemplate.generate(random);
        expect(path[0].y).toBeCloseTo(0, 3);
        expect(path[path.length - 1].y).toBeCloseTo(0, 3);
    });

    it('consumes exactly 1 outer PRNG call', () => {
        let calls = 0;
        const random = (): number => {
            calls++;
            return 0.5;
        };
        tracedTabTemplate.generate(random);
        expect(calls).toBe(1);
    });

    it('is deterministic for a fixed seed', () => {
        const r1 = createSeededRandom(123);
        const r2 = createSeededRandom(123);
        const a = tracedTabTemplate.generate(r1);
        const b = tracedTabTemplate.generate(r2);
        expect(a).toEqual(b);
    });

    it('produces different paths for different outer seeds', () => {
        const a = tracedTabTemplate.generate(createSeededRandom(1));
        const b = tracedTabTemplate.generate(createSeededRandom(2));
        // If the outer call had no effect, the sub-PRNG isn't seeded from it.
        const allEqual = a.length === b.length && a.every((p, i) =>
            Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9,
        );
        expect(allEqual).toBe(false);
    });

    it('produces a path with length matching the picked template (3n+1 cubic Bezier shape)', () => {
        const path = tracedTabTemplate.generate(createSeededRandom(99));
        expect(path.length).toBeGreaterThanOrEqual(4);
        expect((path.length - 1) % 3).toBe(0);
        const libraryLengths = TRACED_TEMPLATES.map(t => t.path.length);
        expect(libraryLengths).toContain(path.length);
    });

    it('preserves chord endpoints x≈mid±half-width after transforms', () => {
        const path = tracedTabTemplate.generate(createSeededRandom(7));
        expect(path[path.length - 1].x).toBeGreaterThan(path[0].x);
    });
});

describe('createTracedTabTemplate', () => {
    it('advances the outer PRNG by exactly one call', () => {
        let calls = 0;
        const counting = (): number => { calls++; return 0.5; };
        createTracedTabTemplate(TRACED_TEMPLATES).generate(counting);
        expect(calls).toBe(1);
    });

    it('selects only from the provided template list', () => {
        // Single-element lists force idx 0, so the outputs differ only by source geometry.
        const onlyFirst = createTracedTabTemplate([TRACED_TEMPLATES[0]]);
        const onlySecond = createTracedTabTemplate([TRACED_TEMPLATES[1]]);
        const a = onlyFirst.generate(createSeededRandom(123));
        const b = onlySecond.generate(createSeededRandom(123));
        expect(a).not.toEqual(b);
    });
});
