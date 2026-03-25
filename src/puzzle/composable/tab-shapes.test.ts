import { describe, it, expect } from 'vitest';
import {
    classicTabTemplate,
    reverseBezierPath,
    mirrorBezierPathY,
    TAB_TEMPLATES,
} from './tab-shapes.js';
import type { BezierPath } from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';

describe('classicTabTemplate', () => {
    it('generates a path starting at (0,0) and ending at (1,0)', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);

        expect(path[0]).toEqual({ x: 0, y: 0 });
        expect(path[path.length - 1]).toEqual({ x: 1, y: 0 });
    });

    it('generates 6 Bézier segments (19 points)', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);

        // 1 start + 6 segments × 3 points each = 19
        expect(path).toHaveLength(19);
    });

    it('tab protrudes in positive Y direction', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);

        // At least some points should have y > 0
        const maxY = Math.max(...path.map(p => p.y));
        expect(maxY).toBeGreaterThan(0);
    });

    it('is reproducible with the same seed', () => {
        const path1 = classicTabTemplate.generate(createSeededRandom(99));
        const path2 = classicTabTemplate.generate(createSeededRandom(99));

        expect(path1).toEqual(path2);
    });

    it('varies with different seeds', () => {
        const path1 = classicTabTemplate.generate(createSeededRandom(1));
        const path2 = classicTabTemplate.generate(createSeededRandom(2));

        // Paths should differ (extremely unlikely to be identical)
        const maxY1 = Math.max(...path1.map(p => p.y));
        const maxY2 = Math.max(...path2.map(p => p.y));
        expect(maxY1).not.toBeCloseTo(maxY2, 5);
    });
});

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

describe('TAB_TEMPLATES', () => {
    it('contains at least the classic template', () => {
        expect(TAB_TEMPLATES.length).toBeGreaterThanOrEqual(1);
        expect(TAB_TEMPLATES[0].name).toBe('Classic');
    });
});
