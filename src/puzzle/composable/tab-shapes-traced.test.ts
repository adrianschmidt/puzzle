import { describe, it, expect } from 'vitest';
import { tracedTabTemplate } from './tab-shapes-traced.js';
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
        // At least one point should differ — if the outer call has no
        // effect on output, the sub-PRNG isn't being seeded from it.
        const allEqual = a.length === b.length && a.every((p, i) =>
            Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9,
        );
        expect(allEqual).toBe(false);
    });

    it('produces a path with length matching the picked template (3n+1 cubic Bezier shape)', () => {
        // For any seed we pick a template from TRACED_TEMPLATES and the
        // output preserves the (3n+1) length invariant.
        const path = tracedTabTemplate.generate(createSeededRandom(99));
        expect(path.length).toBeGreaterThanOrEqual(4);
        expect((path.length - 1) % 3).toBe(0);
        // Length must match one of the library entries.
        const libraryLengths = TRACED_TEMPLATES.map(t => t.path.length);
        expect(libraryLengths).toContain(path.length);
    });

    it('preserves chord endpoints x≈mid±half-width after transforms', () => {
        // After the lateral shift + scale, the chord endpoints should
        // still sit on y=0 (already tested above) and span a positive
        // x range — i.e. start.x < end.x with non-zero width.
        const path = tracedTabTemplate.generate(createSeededRandom(7));
        expect(path[path.length - 1].x).toBeGreaterThan(path[0].x);
    });
});
