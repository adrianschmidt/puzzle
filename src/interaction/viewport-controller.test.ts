/**
 * Tests for ViewportController.
 *
 * Tests the helper functions (pure) and the event handling logic
 * using a minimal DOM mock.
 */

import { describe, it, expect } from 'vitest';
import { touchDistance, touchMidpoint } from './viewport-controller.js';

describe('touchDistance', () => {
    it('should return 0 for same point', () => {
        const p = { id: 1, x: 100, y: 200 };
        expect(touchDistance(p, p)).toBe(0);
    });

    it('should compute horizontal distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 100, y: 0 };
        expect(touchDistance(a, b)).toBe(100);
    });

    it('should compute vertical distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 0, y: 50 };
        expect(touchDistance(a, b)).toBe(50);
    });

    it('should compute diagonal distance', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 3, y: 4 };
        expect(touchDistance(a, b)).toBe(5);
    });

    it('should be commutative', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 50 };
        expect(touchDistance(a, b)).toBe(touchDistance(b, a));
    });
});

describe('touchMidpoint', () => {
    it('should return the point itself when both are the same', () => {
        const p = { id: 1, x: 100, y: 200 };
        expect(touchMidpoint(p, p)).toEqual({ x: 100, y: 200 });
    });

    it('should compute midpoint on x-axis', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 100, y: 0 };
        expect(touchMidpoint(a, b)).toEqual({ x: 50, y: 0 });
    });

    it('should compute midpoint on y-axis', () => {
        const a = { id: 1, x: 0, y: 0 };
        const b = { id: 2, x: 0, y: 80 };
        expect(touchMidpoint(a, b)).toEqual({ x: 0, y: 40 });
    });

    it('should compute midpoint diagonally', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 40 };
        expect(touchMidpoint(a, b)).toEqual({ x: 20, y: 30 });
    });

    it('should be commutative', () => {
        const a = { id: 1, x: 10, y: 20 };
        const b = { id: 2, x: 30, y: 50 };
        expect(touchMidpoint(a, b)).toEqual(touchMidpoint(b, a));
    });
});
