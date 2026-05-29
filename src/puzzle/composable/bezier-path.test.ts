import { describe, it, expect } from 'vitest';
import {
    reverseBezierPath,
    mirrorBezierPathY,
    scaleBezierPath,
} from './bezier-path.js';
import type { BezierPath } from './bezier-path.js';
import { classicTabTemplate } from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';

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
