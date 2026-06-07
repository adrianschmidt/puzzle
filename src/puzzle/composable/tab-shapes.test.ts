import { describe, it, expect } from 'vitest';
import {
    classicTabTemplate,
    TAB_TEMPLATES,
} from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';

describe('classicTabTemplate', () => {
    it('generates a path starting and ending on y=0', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);

        expect(path[0].y).toBe(0);
        expect(path[path.length - 1].y).toBe(0);
        // Start and end are close to the center (short flanges)
        expect(path[0].x).toBeGreaterThan(0.2);
        expect(path[path.length - 1].x).toBeLessThan(0.8);
    });

    it('generates 4 Bézier segments (13 points)', () => {
        const random = createSeededRandom(42);
        const path = classicTabTemplate.generate(random);

        // 1 start + 4 segments × 3 points each = 13
        expect(path).toHaveLength(13);
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

describe('TAB_TEMPLATES', () => {
    it('contains at least the classic template', () => {
        expect(TAB_TEMPLATES.length).toBeGreaterThanOrEqual(1);
        expect(TAB_TEMPLATES[0].name).toBe('Classic');
    });
});
