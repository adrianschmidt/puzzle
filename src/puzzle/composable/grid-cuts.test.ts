import { describe, it, expect } from 'vitest';
import { generateStraightGrid } from './grid-cuts.js';

describe('generateStraightGrid', () => {
    const imageSize = { width: 800, height: 600 };

    it('creates correct dimensions', () => {
        const grid = generateStraightGrid(4, 3, imageSize);
        expect(grid.cols).toBe(4);
        expect(grid.rows).toBe(3);
        expect(grid.pieceWidth).toBe(200);
        expect(grid.pieceHeight).toBe(200);
    });

    it('creates correct number of cuts', () => {
        const grid = generateStraightGrid(4, 3, imageSize);
        // 4 rows of cuts (including top and bottom borders)
        expect(grid.rowCuts).toHaveLength(4);
        // 5 column cuts (including left and right borders)
        expect(grid.colCuts).toHaveLength(5);
    });

    it('creates correct corners', () => {
        const grid = generateStraightGrid(2, 2, imageSize);
        // 3×3 grid of corners
        expect(grid.corners).toHaveLength(3);
        expect(grid.corners[0]).toHaveLength(3);

        // Top-left corner
        expect(grid.corners[0][0].position).toEqual({ x: 0, y: 0 });
        // Bottom-right corner
        expect(grid.corners[2][2].position).toEqual({ x: 800, y: 600 });
        // Centre corner
        expect(grid.corners[1][1].position).toEqual({ x: 400, y: 300 });
    });

    it('marks border edges correctly', () => {
        const grid = generateStraightGrid(3, 2, imageSize);

        // Top-left piece: top and left are border
        expect(grid.edges[0][0].top.isBorder).toBe(true);
        expect(grid.edges[0][0].left.isBorder).toBe(true);
        expect(grid.edges[0][0].right.isBorder).toBe(false);
        expect(grid.edges[0][0].bottom.isBorder).toBe(false);

        // Bottom-right piece: bottom and right are border
        expect(grid.edges[1][2].bottom.isBorder).toBe(true);
        expect(grid.edges[1][2].right.isBorder).toBe(true);
        expect(grid.edges[1][2].top.isBorder).toBe(false);
        expect(grid.edges[1][2].left.isBorder).toBe(false);

        // Interior piece: no borders
        expect(grid.edges[0][1].top.isBorder).toBe(true); // top row is still border
        expect(grid.edges[0][1].bottom.isBorder).toBe(false);
        expect(grid.edges[0][1].left.isBorder).toBe(false);
        expect(grid.edges[0][1].right.isBorder).toBe(false);
    });

    it('edge endpoints match corner positions', () => {
        const grid = generateStraightGrid(2, 2, imageSize);

        // Top edge of piece (0,0) goes from corner (0,0) to corner (0,1)
        const topEdge = grid.edges[0][0].top;
        expect(topEdge.start.position).toEqual(grid.corners[0][0].position);
        expect(topEdge.end.position).toEqual(grid.corners[0][1].position);

        // Right edge of piece (0,0) goes from corner (0,1) to corner (1,1)
        const rightEdge = grid.edges[0][0].right;
        expect(rightEdge.start.position).toEqual(grid.corners[0][1].position);
        expect(rightEdge.end.position).toEqual(grid.corners[1][1].position);
    });

    it('row cuts span full width', () => {
        const grid = generateStraightGrid(4, 3, imageSize);
        for (const cut of grid.rowCuts) {
            expect(cut.points[0].x).toBe(0);
            expect(cut.points[cut.points.length - 1].x).toBe(800);
        }
    });

    it('column cuts span full height', () => {
        const grid = generateStraightGrid(4, 3, imageSize);
        for (const cut of grid.colCuts) {
            expect(cut.points[0].y).toBe(0);
            expect(cut.points[cut.points.length - 1].y).toBe(600);
        }
    });
});
