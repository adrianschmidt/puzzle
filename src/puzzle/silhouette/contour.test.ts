import { describe, it, expect } from 'vitest';
import { traceContour, simplifyClosed, smoothClosed } from './contour.js';

/** componentMap grid from strings ('.'=0, '#'=1). */
function cmap(rows: string[]): { width: number; height: number; map: Int32Array } {
    const height = rows.length, width = rows[0].length;
    const map = new Int32Array(width * height);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) map[y * width + x] = row[x] === '#' ? 1 : 0;
    });
    return { width, height, map };
}

describe('traceContour', () => {
    it('traces a 2×2 block as its 4-corner square', () => {
        const g = cmap([
            '....',
            '.##.',
            '.##.',
            '....',
        ]);
        const poly = traceContour(g.width, g.height, g.map, 1);
        // The boundary rectangle corners (1,1) (3,1) (3,3) (1,3), any start.
        expect(poly.length).toBe(4);
        const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
        expect(new Set(poly.map(key))).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']));
    });

    it('walks an L-shape without self-crossing and closes the loop', () => {
        const g = cmap([
            '.....',
            '.#...',
            '.##..',
            '.....',
        ]);
        const poly = traceContour(g.width, g.height, g.map, 1);
        expect(poly.length).toBe(6); // L-shape has 6 corners
        // Signed area non-zero (valid simple polygon).
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            area += a.x * b.y - b.x * a.y;
        }
        expect(Math.abs(area / 2)).toBe(3); // 3 pixels
    });
});

describe('simplifyClosed', () => {
    it('collapses collinear points', () => {
        const square = [
            { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
            { x: 2, y: 2 }, { x: 0, y: 2 },
        ];
        expect(simplifyClosed(square, 0.1).length).toBe(4);
    });
    it('keeps genuine corners at low tolerance', () => {
        const l = [
            { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
            { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
        ];
        expect(simplifyClosed(l, 0.1)).toEqual(l);
    });
});

describe('smoothClosed', () => {
    it('produces a closed 3n+1 Bézier path', () => {
        const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const path = smoothClosed(square, 0.8);
        expect((path.length - 1) % 3).toBe(0);
        expect(path[0]).toEqual(path[path.length - 1]);
        expect((path.length - 1) / 3).toBe(4); // one segment per polygon edge
    });
    it('strength 0 passes through the polygon corners', () => {
        const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
        const path = smoothClosed(square, 0);
        expect(path[0]).toEqual({ x: 0, y: 0 });
        expect(path[3]).toEqual({ x: 10, y: 0 });
    });
});
