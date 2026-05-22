import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { createSeededRandom } from '../seeded-random.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

describe('computeTabPlacement', () => {
    it('returns null for edges shorter than minEdgeLength * 1.5', () => {
        const random = createSeededRandom(1);
        const shortEdge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(computeTabPlacement(shortEdge, DEFAULT_TAB_PLACEMENT, random)).toBeNull();
    });

    it('returns tCenter and isTab for a long edge', () => {
        const random = createSeededRandom(1);
        const longEdge = Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 });
        const placement = computeTabPlacement(longEdge, DEFAULT_TAB_PLACEMENT, random);
        expect(placement).not.toBeNull();
        expect(placement!.tCenter).toBeGreaterThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[0]);
        expect(placement!.tCenter).toBeLessThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[1]);
        expect(typeof placement!.isTab).toBe('boolean');
    });
});

describe('prepareTab + commitTab', () => {
    it('produces a curve whose start and end match the input edge', () => {
        const random = createSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const prepared = prepareTab(edge, 0.5, true, classicTabTemplate, random);
        expect(prepared).not.toBeNull();
        const result = commitTab(prepared!);
        expect(result.start.x).toBeCloseTo(edge.start.x);
        expect(result.start.y).toBeCloseTo(edge.start.y);
        expect(result.end.x).toBeCloseTo(edge.end.x);
        expect(result.end.y).toBeCloseTo(edge.end.y);
    });
});
