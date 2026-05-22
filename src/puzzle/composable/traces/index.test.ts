import { describe, it, expect } from 'vitest';
import { TRACED_TEMPLATES } from './index.js';

describe('traced template library', () => {
    it('contains at least one trace', () => {
        expect(TRACED_TEMPLATES.length).toBeGreaterThan(0);
    });

    for (const template of TRACED_TEMPLATES) {
        describe(template.id, () => {
            it('has a path with length 3n+1 for n ≥ 1 cubic segments', () => {
                expect(template.path.length).toBeGreaterThanOrEqual(4);
                expect((template.path.length - 1) % 3).toBe(0);
            });

            it('starts at (0, 0) and ends at (1, 0) within tolerance', () => {
                const first = template.path[0];
                const last = template.path[template.path.length - 1];
                expect(first.x).toBeCloseTo(0, 3);
                expect(first.y).toBeCloseTo(0, 3);
                expect(last.x).toBeCloseTo(1, 3);
                expect(last.y).toBeCloseTo(0, 3);
            });

            it('has all landmark fractions inside [0, 1]', () => {
                const lm = template.landmarks;
                for (const v of [
                    lm.apex_y,
                    lm.head.y, lm.head.width, lm.head.center_x,
                    lm.neck.y, lm.neck.width, lm.neck.center_x,
                ]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                }
            });

            it('has neck below head', () => {
                expect(template.landmarks.neck.y).toBeLessThan(template.landmarks.head.y);
            });
        });
    }
});
