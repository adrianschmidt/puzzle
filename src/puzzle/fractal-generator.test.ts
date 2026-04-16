import { describe, test, expect } from 'vitest';
import { generateFractalPuzzle, scaleFractalGrid } from './fractal-generator.js';

describe('generateFractalPuzzle', () => {
    const imageSize = { width: 400, height: 300 };
    const seed = 42;

    test('generates pieces with valid structure', () => {
        const cols = 4;
        const rows = 3;
        const pieces = generateFractalPuzzle(cols, rows, imageSize, seed);

        // Should generate pieces (exact count may vary due to organic nature)
        expect(pieces.length).toBeGreaterThan(0);
        expect(pieces.length).toBeLessThan(cols * rows * 2); // Reasonable upper bound

        // Each piece should have valid structure
        for (const piece of pieces) {
            expect(piece.id).toBeGreaterThanOrEqual(0);
            expect(piece.edges.length).toBeGreaterThan(0);
            expect(piece.shape).toBeTruthy();
            expect(typeof piece.imageOffset.x).toBe('number');
            expect(typeof piece.imageOffset.y).toBe('number');

            // Each edge should have valid properties
            for (const edge of piece.edges) {
                expect(edge.id).toBeGreaterThanOrEqual(0);
                expect(edge.path).toBeTruthy();
                expect(typeof edge.start.x).toBe('number');
                expect(typeof edge.start.y).toBe('number');
                expect(typeof edge.end.x).toBe('number');
                expect(typeof edge.end.y).toBe('number');

                // Mate relationships should be consistent
                if (edge.matePieceId !== -1) {
                    expect(edge.mateEdgeId).not.toBe(-1);
                } else {
                    // Border edge should have mate fields set to -1
                    expect(edge.mateEdgeId).toBe(-1);
                }
            }
        }
    });

    test('generates reproducible results with same seed', () => {
        const pieces1 = generateFractalPuzzle(3, 3, imageSize, 99999);
        const pieces2 = generateFractalPuzzle(3, 3, imageSize, 99999);

        expect(pieces1.length).toBe(pieces2.length);

        for (let i = 0; i < pieces1.length; i++) {
            expect(pieces1[i].id).toBe(pieces2[i].id);
            expect(pieces1[i].edges.length).toBe(pieces2[i].edges.length);
            expect(pieces1[i].shape).toBe(pieces2[i].shape);
            expect(pieces1[i].imageOffset).toEqual(pieces2[i].imageOffset);

            for (let j = 0; j < pieces1[i].edges.length; j++) {
                expect(pieces1[i].edges[j]).toEqual(pieces2[i].edges[j]);
            }
        }
    });

    test('generates different results with different seeds', () => {
        const pieces1 = generateFractalPuzzle(4, 4, imageSize, 1);
        const pieces2 = generateFractalPuzzle(4, 4, imageSize, 2);

        // Should be different (very unlikely to be identical with organic generation)
        const shapes1 = pieces1.map(p => p.shape).sort();
        const shapes2 = pieces2.map(p => p.shape).sort();
        expect(shapes1).not.toEqual(shapes2);
    });

    test('handles small grid (2x2)', () => {
        // Fractal algorithm needs at least 2 tiles for diagonal connections.
        // A 2x2 grid is the minimum viable size.
        const pieces = generateFractalPuzzle(2, 2, { width: 100, height: 100 }, 42);

        expect(pieces.length).toBeGreaterThanOrEqual(1);

        for (const piece of pieces) {
            expect(piece.edges.length).toBeGreaterThan(0);
            expect(piece.shape).toBeTruthy();
        }
    });

    test('handles various puzzle sizes', () => {
        // Small puzzle
        const small = generateFractalPuzzle(2, 2, { width: 200, height: 200 }, 42);
        expect(small.length).toBeGreaterThan(0);

        // Large puzzle (should generate more pieces)
        const large = generateFractalPuzzle(8, 6, { width: 800, height: 600 }, 42);
        expect(large.length).toBeGreaterThan(0);
        expect(large.length).toBeGreaterThan(small.length);
    });

    test('mate relationships are bidirectional', () => {
        const pieces = generateFractalPuzzle(3, 3, imageSize, 42);
        
        // Build a map of all edges
        const edgeMap = new Map<number, { piece: typeof pieces[0], edge: typeof pieces[0]['edges'][0] }>();
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                edgeMap.set(edge.id, { piece, edge });
            }
        }
        
        // Check mate relationships
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.matePieceId !== -1 && edge.mateEdgeId !== -1) {
                    const mateInfo = edgeMap.get(edge.mateEdgeId);
                    expect(mateInfo).toBeTruthy();
                    
                    if (mateInfo) {
                        const mateEdge = mateInfo.edge;
                        expect(mateEdge.matePieceId).toBe(piece.id);
                        expect(mateEdge.mateEdgeId).toBe(edge.id);
                    }
                }
            }
        }
    });

    test('all pieces have unique IDs', () => {
        const pieces = generateFractalPuzzle(4, 3, imageSize, 42);
        const pieceIds = pieces.map(p => p.id);
        const uniqueIds = new Set(pieceIds);
        expect(uniqueIds.size).toBe(pieceIds.length);
    });

    test('all edges have unique IDs', () => {
        const pieces = generateFractalPuzzle(4, 3, imageSize, 42);
        const edgeIds: number[] = [];
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                edgeIds.push(edge.id);
            }
        }
        const uniqueIds = new Set(edgeIds);
        expect(uniqueIds.size).toBe(edgeIds.length);
    });

    test('gap-filler diamonds register as mated edges (issue #214)', () => {
        // Gap-filler diamonds used to be raw SVG sub-paths with no Edge
        // objects, so every concave arc bordering a gap cell stayed at
        // mateEdgeId === -1. The fix adds four Edge objects per diamond
        // and pairs each with the neighbouring concave arc it coincides
        // with.
        //
        // A piece's shape now consists of a main-contour sub-path plus
        // one extra closed sub-path per diamond filler — so the number of
        // "M " commands in the path tells us how many diamonds the piece
        // owns. Diamond edges are always the trailing four-edge blocks.
        const cases: Array<[number, number, number]> = [
            [4, 4, 1], [4, 4, 2], [4, 4, 3],
            [6, 4, 42], [8, 6, 7], [6, 6, 99],
        ];

        let totalDiamondEdges = 0;

        for (const [cols, rows, seed] of cases) {
            const pieces = generateFractalPuzzle(cols, rows, imageSize, seed);

            for (const piece of pieces) {
                const subPathCount = (piece.shape.match(/M /g) ?? []).length;
                const diamondCount = subPathCount - 1;
                if (diamondCount <= 0) continue;

                const expectedDiamondEdges = diamondCount * 4;
                expect(
                    piece.edges.length,
                    `piece ${piece.id} (cols=${cols} rows=${rows} seed=${seed}) `
                    + `has ${subPathCount} sub-paths but only `
                    + `${piece.edges.length} edges`,
                ).toBeGreaterThanOrEqual(expectedDiamondEdges);

                const diamondEdges = piece.edges.slice(-expectedDiamondEdges);
                for (const edge of diamondEdges) {
                    expect(
                        edge.mateEdgeId,
                        `diamond edge ${edge.id} on piece ${piece.id} `
                        + `(cols=${cols} rows=${rows} seed=${seed}) is mateless`,
                    ).not.toBe(-1);
                    expect(edge.matePieceId).not.toBe(-1);
                }
                totalDiamondEdges += expectedDiamondEdges;
            }
        }

        // Make sure at least one case actually produced a gap filler, so
        // this test is not silently passing on all-main-contour puzzles.
        expect(totalDiamondEdges).toBeGreaterThan(0);
    });
});

describe('scaleFractalGrid', () => {
    const LANDSCAPE_ASPECT = 4 / 3; // 800×600

    test('returns cols and rows as even numbers ≥ 4', () => {
        for (const target of [24, 48, 96, 192]) {
            const { cols, rows } = scaleFractalGrid(target, LANDSCAPE_ASPECT);
            expect(cols).toBeGreaterThanOrEqual(4);
            expect(rows).toBeGreaterThanOrEqual(4);
            expect(cols % 2).toBe(0);
            expect(rows % 2).toBe(0);
        }
    });

    test('larger targets produce larger grids', () => {
        const small = scaleFractalGrid(24, LANDSCAPE_ASPECT);
        const medium = scaleFractalGrid(48, LANDSCAPE_ASPECT);
        const large = scaleFractalGrid(96, LANDSCAPE_ASPECT);
        const xlarge = scaleFractalGrid(192, LANDSCAPE_ASPECT);

        expect(small.cols * small.rows).toBeLessThan(medium.cols * medium.rows);
        expect(medium.cols * medium.rows).toBeLessThan(large.cols * large.rows);
        expect(large.cols * large.rows).toBeLessThan(xlarge.cols * xlarge.rows);
    });

    test('respects image aspect ratio (landscape has more cols than rows)', () => {
        const { cols, rows } = scaleFractalGrid(96, 2.0); // very wide image
        expect(cols).toBeGreaterThan(rows);
    });

    test('respects image aspect ratio (portrait has more rows than cols)', () => {
        const { cols, rows } = scaleFractalGrid(96, 0.5); // tall image
        expect(rows).toBeGreaterThan(cols);
    });

    test('square aspect ratio produces roughly equal cols and rows', () => {
        const { cols, rows } = scaleFractalGrid(96, 1.0);
        expect(Math.abs(cols - rows)).toBeLessThanOrEqual(2);
    });

    test('scaled grid produces approximately target piece count', () => {
        const imageSize = { width: 800, height: 600 };

        for (const target of [24, 48, 96, 192]) {
            const { cols, rows } = scaleFractalGrid(
                target,
                imageSize.width / imageSize.height,
            );

            // Generate multiple puzzles and check the average
            const counts: number[] = [];
            for (let seed = 1; seed <= 20; seed++) {
                const pieces = generateFractalPuzzle(
                    cols, rows, imageSize, seed,
                );
                counts.push(pieces.length);
            }
            const avg = counts.reduce((a, b) => a + b) / counts.length;

            // Average should be within 25% of target
            expect(avg).toBeGreaterThan(target * 0.75);
            expect(avg).toBeLessThan(target * 1.25);
        }
    });
});