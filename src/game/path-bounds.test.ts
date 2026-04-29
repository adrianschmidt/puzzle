/**
 * Tests for SVG path-bounds parsing.
 */

import { describe, it, expect } from 'vitest';
import { getPathBounds } from './path-bounds.js';

describe('getPathBounds', () => {
    it('should return start point bounds for empty path', () => {
        const bounds = getPathBounds('', { x: 10, y: 20 });
        expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 20 });
    });

    it('should handle absolute line commands', () => {
        const bounds = getPathBounds('M 0 0 L 100 50 L 50 100', { x: 0, y: 0 });
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    });

    it('should handle relative line commands', () => {
        const bounds = getPathBounds('l 100 0 l 0 80', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 110, maxY: 90 });
    });

    it('should include cubic bezier control points (absolute)', () => {
        // Control points at (50, -30) and (50, 130) extend beyond endpoints
        const bounds = getPathBounds('C 50 -30, 50 130, 100 50', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-30);
        expect(bounds.maxY).toBe(130);
        expect(bounds.maxX).toBe(100);
    });

    it('should include cubic bezier control points (relative)', () => {
        const bounds = getPathBounds('c 20 -40, 80 -40, 100 0', { x: 0, y: 50 });
        expect(bounds.minY).toBe(10); // 50 + (-40)
        expect(bounds.maxX).toBe(100);
    });

    it('should include quadratic bezier control points', () => {
        const bounds = getPathBounds('Q 50 -20, 100 0', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-20);
        expect(bounds.maxX).toBe(100);
    });

    it('should handle H and V commands', () => {
        const bounds = getPathBounds('H 200 V 150', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 200, maxY: 150 });
    });

    it('should handle relative h and v commands', () => {
        const bounds = getPathBounds('h 50 v 30', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 40 });
    });

    it('should handle S (smooth cubic) commands', () => {
        const bounds = getPathBounds('S 50 -20, 100 0', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-20);
        expect(bounds.maxX).toBe(100);
    });

    it('should handle Z command without error', () => {
        const bounds = getPathBounds('L 100 100 Z', { x: 0, y: 0 });
        expect(bounds.maxX).toBe(100);
        expect(bounds.maxY).toBe(100);
    });

    it('should handle a realistic jigsaw tab path', () => {
        // Simulates a tab that bulges outward (negative y = upward)
        const path = 'L 30 0 C 35 -25, 65 -25, 70 0 L 100 0';
        const bounds = getPathBounds(path, { x: 0, y: 0 });
        expect(bounds.minY).toBe(-25);
        expect(bounds.maxX).toBe(100);
        expect(bounds.minX).toBe(0);
    });
});
