import { describe, it, expect, vi } from 'vitest';
import { TRACED_TEMPLATES, assertTracedTemplate, getTracedTemplates } from './index.js';
import { CURRENT_TRACE_SET_VERSION } from './trace-set-version.js';
import { diagnostics } from '../../../diagnostics.js';

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

            it('has all landmark fractions non-negative', () => {
                // All values are in chord-length units. Y and width can
                // exceed 1 for tall or wide tabs (the chord normalizes x
                // to 1, not the shape's bounding box), so only check
                // non-negativity here. center_x has its own bounds check.
                const lm = template.landmarks;
                for (const v of [
                    lm.apex_y,
                    lm.head.y, lm.head.width, lm.head.center_x,
                    lm.neck.y, lm.neck.width, lm.neck.center_x,
                ]) {
                    expect(v).toBeGreaterThanOrEqual(0);
                }
            });

            it('has head and neck centers near the chord (center_x in [0, 1])', () => {
                expect(template.landmarks.head.center_x).toBeGreaterThanOrEqual(0);
                expect(template.landmarks.head.center_x).toBeLessThanOrEqual(1);
                expect(template.landmarks.neck.center_x).toBeGreaterThanOrEqual(0);
                expect(template.landmarks.neck.center_x).toBeLessThanOrEqual(1);
            });

            it('has neck below head', () => {
                expect(template.landmarks.neck.y).toBeLessThan(template.landmarks.head.y);
            });
        });
    }
});

describe('assertTracedTemplate', () => {
    const ok = TRACED_TEMPLATES[0];

    it('accepts a valid template unchanged', () => {
        expect(assertTracedTemplate(ok, 'ok')).toBe(ok);
    });

    it('rejects null', () => {
        expect(() => assertTracedTemplate(null, 'x')).toThrow(/not an object/);
    });

    it('rejects a missing id', () => {
        const { id: _id, ...rest } = ok as unknown as Record<string, unknown>;
        expect(() => assertTracedTemplate(rest, 'x')).toThrow(/id/);
    });

    it('rejects a path whose length is not 3n+1', () => {
        const bad = { ...ok, path: ok.path.slice(0, 5) };
        expect(() => assertTracedTemplate(bad, 'x')).toThrow(/path length/);
    });

    it('rejects a path containing NaN', () => {
        const bad = { ...ok, path: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }] };
        expect(() => assertTracedTemplate(bad, 'x')).toThrow(/finite Point/);
    });

    it('rejects landmarks with a non-finite field', () => {
        const bad = {
            ...ok,
            landmarks: { ...ok.landmarks, apex_y: Infinity },
        };
        expect(() => assertTracedTemplate(bad, 'x')).toThrow(/apex_y/);
    });

    it('rejects landmarks missing a sub-object', () => {
        const { neck: _neck, ...rest } = ok.landmarks as unknown as Record<string, unknown>;
        const bad = { ...ok, landmarks: rest };
        expect(() => assertTracedTemplate(bad, 'x')).toThrow(/neck/);
    });
});

describe('trace-set versioning', () => {
    it('CURRENT_TRACE_SET_VERSION is a positive integer', () => {
        expect(Number.isInteger(CURRENT_TRACE_SET_VERSION)).toBe(true);
        expect(CURRENT_TRACE_SET_VERSION).toBeGreaterThanOrEqual(1);
    });

    it('version 1 resolves to the original ordered library', () => {
        expect(getTracedTemplates(1)).toEqual(TRACED_TEMPLATES);
    });

    it('falls back to v1 for an unknown version', () => {
        expect(getTracedTemplates(999)).toEqual(TRACED_TEMPLATES);
    });

    it('warns on the unknown-version fallback (breadcrumb for a regressed clamp)', () => {
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        try {
            getTracedTemplates(999);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('999'));
        } finally {
            warn.mockRestore();
        }
    });

    it('does not warn for a known version', () => {
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        try {
            getTracedTemplates(1);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
