import { describe, it, expect } from 'vitest';
import {
    fmt,
    reverseBezierPath,
    mirrorBezierPathY,
    scaleBezierPath,
} from './bezier-path.js';
import type { BezierPath } from './bezier-path.js';
import { classicTabTemplate } from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';
import { GEOMETRY_PRECISION_DECIMALS } from '../../model/quantize-geometry.js';

describe('reverseBezierPath', () => {
    it('reverses start and end points', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);
        const reversed = reverseBezierPath(path);

        expect(reversed[0]).toEqual(path[path.length - 1]);
        expect(reversed[reversed.length - 1]).toEqual(path[0]);
    });

    it('preserves path length', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);
        const reversed = reverseBezierPath(path);

        expect(reversed).toHaveLength(path.length);
    });

    it('double reversal returns original', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);
        const doubleReversed = reverseBezierPath(reverseBezierPath(path));

        for (let i = 0; i < path.length; i++) {
            expect(doubleReversed[i].x).toBeCloseTo(path[i].x, 10);
            expect(doubleReversed[i].y).toBeCloseTo(path[i].y, 10);
        }
    });

    it('swaps control points within each segment', () => {
        // Single-segment path: [p0, cp1, cp2, p1]
        const path: BezierPath = [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
            { x: 1, y: 0 },
        ];
        const reversed = reverseBezierPath(path);

        // After reversal: [p1, cp2, cp1, p0]
        expect(reversed).toEqual([
            { x: 1, y: 0 },
            { x: 0.75, y: 0.5 },
            { x: 0.25, y: 0.5 },
            { x: 0, y: 0 },
        ]);
    });
});

describe('scaleBezierPath', () => {
    it('scales x and y of every point independently', () => {
        const path = [
            { x: 0, y: 0 },
            { x: 2, y: 4 },
            { x: 6, y: 8 },
            { x: 10, y: 0 },
        ];
        const out = scaleBezierPath(path, 0.5, 0.25);
        expect(out).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 3, y: 2 },
            { x: 5, y: 0 },
        ]);
    });

    it('does not mutate the input', () => {
        const path = [{ x: 1, y: 1 }];
        scaleBezierPath(path, 2, 2);
        expect(path[0]).toEqual({ x: 1, y: 1 });
    });
});

describe('mirrorBezierPathY', () => {
    it('negates Y coordinates', () => {
        const path: BezierPath = [
            { x: 0, y: 0 },
            { x: 0.2, y: 0.1 },
            { x: 0.4, y: 0.2 },
            { x: 0.5, y: 0.3 },
        ];

        const mirrored = mirrorBezierPathY(path);

        expect(mirrored[0]).toEqual({ x: 0, y: -0 });
        expect(mirrored[1]).toEqual({ x: 0.2, y: -0.1 });
        expect(mirrored[2]).toEqual({ x: 0.4, y: -0.2 });
        expect(mirrored[3]).toEqual({ x: 0.5, y: -0.3 });
    });

    it('preserves X coordinates', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);
        const mirrored = mirrorBezierPathY(path);

        for (let i = 0; i < path.length; i++) {
            expect(mirrored[i].x).toBe(path[i].x);
        }
    });
});

describe('fmt', () => {
    /**
     * `GEOMETRY_PRECISION_DECIMALS` is derived from this function: stored
     * coordinates are rounded to the precision `fmt` can render, so finer
     * values cannot reach the screen. Having `fmt` read that constant would
     * point the rendering pipeline at a storage constant — backwards, since
     * `fmt` is the one that decides. Pinning the coupling in a test keeps the
     * dependency in the direction it belongs while still failing loudly if
     * `fmt` is raised to a finer precision, which would otherwise silently
     * make storage the binding constraint on rendered geometry.
     */
    it('renders at the precision GEOMETRY_PRECISION_DECIMALS is anchored to', () => {
        const [, fraction] = fmt(1 / 3).split('.');

        expect(
            fraction,
            "fmt's precision changed: GEOMETRY_PRECISION_DECIMALS " +
            '(model/quantize-geometry.ts) is derived from it and has to move with ' +
            'it, or stored geometry becomes the binding constraint on rendered geometry',
        ).toHaveLength(GEOMETRY_PRECISION_DECIMALS);
    });

    it('drops the fraction entirely for integers', () => {
        expect(fmt(12)).toBe('12');
        expect(fmt(-0)).toBe('0');
    });
});
