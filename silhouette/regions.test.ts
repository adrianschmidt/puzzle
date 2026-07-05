import { describe, it, expect } from 'vitest';
import { findRegions } from './regions.js';

/** labels grid from strings: '0011' rows → Int32Array. */
function grid(rows: string[]): { width: number; height: number; labels: Int32Array } {
    const height = rows.length, width = rows[0].length;
    const labels = new Int32Array(width * height);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) labels[y * width + x] = Number(row[x]);
    });
    return { width, height, labels };
}

const PALETTE: Array<[number, number, number]> = [
    [0.2, 0, 0], [0.8, 0, 0], [0.5, 0.1, -0.1],
];

describe('findRegions', () => {
    it('separates same-label areas that are not connected', () => {
        const g = grid([
            '00100',
            '00100',
            '00100',
        ]);
        // Label 0 appears as two components (left and right of the 1-stripe).
        const { regions } = findRegions(g.width, g.height, g.labels, PALETTE);
        expect(regions.length).toBe(3);
    });

    it('computes area, frame contact, and adjacency', () => {
        const g = grid([
            '000000',
            '011000',
            '011000',
            '000000',
        ]);
        const { regions, componentMap } = findRegions(g.width, g.height, g.labels, PALETTE);
        expect(regions.length).toBe(2);
        const inner = regions.find(r => r.area === 4)!;
        const outer = regions.find(r => r.area === 20)!;
        expect(inner.touchesFrame).toBe(false);
        expect(outer.touchesFrame).toBe(true);
        expect(inner.neighbors.has(outer.id)).toBe(true);
        expect(outer.neighbors.has(inner.id)).toBe(true);
        // componentMap covers every pixel.
        expect(componentMap.length).toBe(24);
    });

    it('gives an isolated high-contrast region a higher contrast score', () => {
        const g = grid([
            '000000',
            '011000',
            '011220',
            '002220',
            '000000',
        ]);
        const { regions } = findRegions(g.width, g.height, g.labels, PALETTE);
        const r1 = regions.find(r => r.meanColor[0] === 0.8)!; // label 1: far from 0
        const r2 = regions.find(r => r.meanColor[0] === 0.5)!; // label 2: nearer 0
        expect(r1.contrast).toBeGreaterThan(r2.contrast);
    });
});
