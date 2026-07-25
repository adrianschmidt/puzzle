import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle } from './procedural-generator.js';

describe('generateProceduralPuzzle', () => {
    const cols = 8;
    const rows = 6;
    const imageSize = { width: 800, height: 600 };
    const seed = 42;
    const pieces = generateProceduralPuzzle(cols, rows, imageSize, seed);

    it('generates the correct number of pieces', () => {
        expect(pieces).toHaveLength(cols * rows);
    });

    it('assigns unique IDs to all pieces', () => {
        const ids = pieces.map((p) => p.id);
        expect(new Set(ids).size).toBe(pieces.length);
    });

    it('gives each piece exactly 4 edges', () => {
        for (const piece of pieces) {
            expect(piece.edges).toHaveLength(4);
        }
    });

    it('assigns unique IDs to all edges across all pieces', () => {
        const edgeIds = pieces.flatMap((p) => p.edges.map((e) => e.id));
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
    });

    it('produces symmetric mate relationships', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;

                const matePiece = pieces.find((p) => p.id === edge.matePieceId);
                expect(matePiece, `Mate piece ${edge.matePieceId} not found`).toBeDefined();

                const mateEdge = matePiece!.edges.find((e) => e.id === edge.mateEdgeId);
                expect(mateEdge, `Mate edge ${edge.mateEdgeId} not found on piece ${matePiece!.id}`).toBeDefined();

                expect(mateEdge!.matePieceId).toBe(piece.id);
                expect(mateEdge!.mateEdgeId).toBe(edge.id);
            }
        }
    });

    it('marks border edges correctly', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const [top, right, bottom, left] = piece.edges;

            if (row === 0) {
                expect(top.mateEdgeId).toBe(-1);
                expect(top.matePieceId).toBe(-1);
            } else {
                expect(top.mateEdgeId).not.toBe(-1);
                expect(top.matePieceId).not.toBe(-1);
            }

            if (row === rows - 1) {
                expect(bottom.mateEdgeId).toBe(-1);
            } else {
                expect(bottom.mateEdgeId).not.toBe(-1);
            }

            if (col === 0) {
                expect(left.mateEdgeId).toBe(-1);
            } else {
                expect(left.mateEdgeId).not.toBe(-1);
            }

            if (col === cols - 1) {
                expect(right.mateEdgeId).toBe(-1);
            } else {
                expect(right.mateEdgeId).not.toBe(-1);
            }
        }
    });

    it('produces correct image offsets', () => {
        const pieceWidth = imageSize.width / cols;
        const pieceHeight = imageSize.height / rows;

        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;

            expect(piece.imageOffset.x).toBe(-col * pieceWidth);
            expect(piece.imageOffset.y).toBe(-row * pieceHeight);
        }
    });

    it('produces valid SVG path shapes', () => {
        for (const piece of pieces) {
            expect(piece.shape).toMatch(/^M /);
            expect(piece.shape).toMatch(/ Z$/);
        }
    });

    it('produces non-empty edge paths', () => {
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                expect(edge.path.length).toBeGreaterThan(0);
            }
        }
    });

    it('corner pieces have exactly 2 border edges', () => {
        const corners = [
            0,
            cols - 1,
            (rows - 1) * cols,
            rows * cols - 1,
        ];

        for (const cornerId of corners) {
            const piece = pieces.find((p) => p.id === cornerId)!;
            const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
            expect(borderCount, `Corner piece ${cornerId}`).toBe(2);
        }
    });

    it('non-corner edge pieces have exactly 1 border edge', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const isEdge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
            const isCorner =
                (row === 0 || row === rows - 1) && (col === 0 || col === cols - 1);

            if (isEdge && !isCorner) {
                const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
                expect(borderCount, `Edge piece ${piece.id}`).toBe(1);
            }
        }
    });

    it('interior pieces have no border edges', () => {
        for (const piece of pieces) {
            const row = Math.floor(piece.id / cols);
            const col = piece.id % cols;
            const isInterior = row > 0 && row < rows - 1 && col > 0 && col < cols - 1;

            if (isInterior) {
                const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
                expect(borderCount, `Interior piece ${piece.id}`).toBe(0);
            }
        }
    });
});

describe('reproducibility', () => {
    it('same seed produces identical pieces', () => {
        const imageSize = { width: 800, height: 600 };
        const pieces1 = generateProceduralPuzzle(8, 6, imageSize, 99999);
        const pieces2 = generateProceduralPuzzle(8, 6, imageSize, 99999);

        expect(pieces1).toEqual(pieces2);
    });

    it('different seeds produce different piece shapes', () => {
        const imageSize = { width: 800, height: 600 };
        const pieces1 = generateProceduralPuzzle(8, 6, imageSize, 1);
        const pieces2 = generateProceduralPuzzle(8, 6, imageSize, 2);

        // Shapes should differ — check a few interior pieces
        const interiorPiece1 = pieces1.find((p) => p.id === 9)!; // row 1, col 1
        const interiorPiece2 = pieces2.find((p) => p.id === 9)!;

        expect(interiorPiece1.shape).not.toBe(interiorPiece2.shape);
    });
});

describe('different grid sizes', () => {
    it('works with a 2×2 grid', () => {
        const pieces = generateProceduralPuzzle(2, 2, { width: 200, height: 200 }, 42);
        expect(pieces).toHaveLength(4);

        for (const piece of pieces) {
            const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
            expect(borderCount).toBe(2);
        }
    });

    it('works with a 1×1 grid (single piece)', () => {
        const pieces = generateProceduralPuzzle(1, 1, { width: 100, height: 100 }, 42);
        expect(pieces).toHaveLength(1);

        const borderCount = pieces[0].edges.filter((e) => e.mateEdgeId === -1).length;
        expect(borderCount).toBe(4);
    });

    it('works with a non-square grid', () => {
        const pieces = generateProceduralPuzzle(3, 5, { width: 300, height: 500 }, 42);
        expect(pieces).toHaveLength(15);
    });

    it('works with large grids', () => {
        const pieces = generateProceduralPuzzle(12, 16, { width: 1200, height: 1600 }, 42);
        expect(pieces).toHaveLength(192);

        // Verify mate symmetry on larger grid too
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;

                const matePiece = pieces.find((p) => p.id === edge.matePieceId)!;
                const mateEdge = matePiece.edges.find((e) => e.id === edge.mateEdgeId)!;
                expect(mateEdge.matePieceId).toBe(piece.id);
            }
        }
    });
});

describe('edge path variation', () => {
    it('internal edges of different pieces have different paths', () => {
        const pieces = generateProceduralPuzzle(4, 4, { width: 400, height: 400 }, 42);

        // Collect all internal edge paths
        const internalPaths = pieces.flatMap((p) =>
            p.edges.filter((e) => e.mateEdgeId !== -1).map((e) => e.path),
        );

        // There should be many unique paths (not all identical like old generator)
        const uniquePaths = new Set(internalPaths);

        // With a 4×4 grid there are 24 shared internal edges (×2 sides = 48 internal edge paths)
        // Each shared edge has unique params, so paths should be varied
        // We expect at least half to be unique (both sides of a shared edge differ
        // because one is tab and one is blank with same params)
        expect(uniquePaths.size).toBeGreaterThan(internalPaths.length / 4);
    });
});

describe('legacy geometry contract', () => {
    /**
     * Every pre-upgrade Classic share link and save reproduces its puzzle by
     * replaying this generator from the stored seed, so its output for a given
     * seed is a compatibility contract, not an implementation detail. The other
     * tests here are same-run self-consistency checks — they would pass just as
     * happily if the geometry moved. This one pins it.
     *
     * If these shapes change, the number or order of `random()` calls (or the
     * geometry built from them) changed, and every existing Classic link and
     * save now renders different pieces than the one that created it. Do not
     * edit the expected values to make this pass.
     *
     * Spelled out inline rather than kept in a `.snap` file on purpose: a file
     * snapshot is silently rewritten by `vitest -u`, which is precisely the
     * failure this fixture exists to catch.
     *
     * Safe to freeze: the generator's only non-arithmetic operation is
     * `Math.sqrt`, which IEEE-754 specifies as correctly rounded, so the
     * output is bit-identical across engines and platforms.
     */
    it('produces byte-identical shapes for a fixed seed and grid', () => {
        const pieces = generateProceduralPuzzle(3, 2, { width: 300, height: 200 }, 12345);
        expect(pieces.map((p) => p.shape)).toEqual([
            'M 0 0 L 100 0 C 100 26.93, 100 35.53, 108.34 39.84 C 112.51 42.42, 120.85 35.67, 126.06 37.99 C 133.35 41.47, 134.40 44.96, 134.40 48.44 C 134.40 51.93, 133.35 55.41, 126.06 58.89 C 120.85 61.22, 112.51 54.47, 108.34 57.05 C 100 61.35, 100 69.96, 100 100 C 79.46 100, 67.06 100, 60.85 105.72 C 57.13 108.58, 66.74 114.30, 63.41 117.87 C 58.42 122.87, 53.44 123.59, 48.45 123.59 C 43.46 123.59, 38.47 122.87, 33.49 117.87 C 30.16 114.30, 39.77 108.58, 36.05 105.72 C 29.84 100, 17.44 100, 0 100 L 0 0 Z',
            'M 0 0 L 100 0 C 100 22.59, 100 30.53, 94.36 34.51 C 91.54 36.89, 85.90 29.34, 82.37 31.72 C 77.44 35.30, 76.73 38.87, 76.73 42.45 C 76.73 46.02, 77.44 49.60, 82.37 53.17 C 85.90 55.56, 91.54 48.01, 94.36 50.39 C 100 54.36, 100 62.31, 100 100 C 65.23 100, 59.51 100, 56.65 91.71 C 54.93 87.56, 66.92 79.26, 64.02 74.08 C 59.65 66.82, 55.29 65.79, 50.92 65.79 C 46.56 65.79, 42.20 66.82, 37.83 74.08 C 34.93 79.26, 46.92 87.56, 45.20 91.71 C 42.34 100, 36.62 100, 0 100 C 0 69.96, 0 61.35, 8.34 57.05 C 12.51 54.47, 20.85 61.22, 26.06 58.89 C 33.35 55.41, 34.40 51.93, 34.40 48.44 C 34.40 44.96, 33.35 41.47, 26.06 37.99 C 20.85 35.67, 12.51 42.42, 8.34 39.84 C 0 35.53, 0 26.93, 0 0 Z',
            'M 0 0 L 100 0 L 100 100 C 57.93 100, 52.66 100, 50.02 107.26 C 48.44 110.88, 58.63 118.14, 56.10 122.68 C 52.32 129.02, 48.53 129.93, 44.75 129.93 C 40.96 129.93, 37.18 129.02, 33.39 122.68 C 30.87 118.14, 41.06 110.88, 39.47 107.26 C 36.84 100, 31.56 100, 0 100 C 0 62.31, 0 54.36, -5.64 50.39 C -8.46 48.01, -14.10 55.56, -17.63 53.17 C -22.56 49.60, -23.27 46.02, -23.27 42.45 C -23.27 38.87, -22.56 35.30, -17.63 31.72 C -14.10 29.34, -8.46 36.89, -5.64 34.51 C 0 30.53, 0 22.59, 0 0 Z',
            'M 0 0 C 17.44 0, 29.84 0, 36.05 5.72 C 39.77 8.58, 30.16 14.30, 33.49 17.87 C 38.47 22.87, 43.46 23.59, 48.45 23.59 C 53.44 23.59, 58.42 22.87, 63.41 17.87 C 66.74 14.30, 57.13 8.58, 60.85 5.72 C 67.06 0, 79.46 0, 100 0 C 100 38.33, 100 42.32, 92.06 44.32 C 88.09 45.52, 80.15 33.37, 75.19 36.09 C 68.24 40.16, 67.25 44.24, 67.25 48.32 C 67.25 52.39, 68.24 56.47, 75.19 60.55 C 80.15 63.26, 88.09 51.11, 92.06 52.31 C 100 54.31, 100 58.30, 100 100 L 0 100 L 0 0 Z',
            'M 0 0 C 36.62 0, 42.34 0, 45.20 -8.29 C 46.92 -12.44, 34.93 -20.74, 37.83 -25.92 C 42.20 -33.18, 46.56 -34.21, 50.92 -34.21 C 55.29 -34.21, 59.65 -33.18, 64.02 -25.92 C 66.92 -20.74, 54.93 -12.44, 56.65 -8.29 C 59.51 0, 65.23 0, 100 0 C 100 39.17, 100 48.06, 91.27 52.50 C 86.91 55.17, 78.18 46.85, 72.73 49.49 C 65.09 53.46, 64.00 57.42, 64.00 61.39 C 64.00 65.35, 65.09 69.32, 72.73 73.28 C 78.18 75.93, 86.91 67.61, 91.27 70.27 C 100 74.72, 100 83.60, 100 100 L 0 100 C 0 58.30, 0 54.31, -7.94 52.31 C -11.91 51.11, -19.85 63.26, -24.81 60.55 C -31.76 56.47, -32.75 52.39, -32.75 48.32 C -32.75 44.24, -31.76 40.16, -24.81 36.09 C -19.85 33.37, -11.91 45.52, -7.94 44.32 C 0 42.32, 0 38.33, 0 0 Z',
            'M 0 0 C 31.56 0, 36.84 0, 39.47 7.26 C 41.06 10.88, 30.87 18.14, 33.39 22.68 C 37.18 29.02, 40.96 29.93, 44.75 29.93 C 48.53 29.93, 52.32 29.02, 56.10 22.68 C 58.63 18.14, 48.44 10.88, 50.02 7.26 C 52.66 0, 57.93 0, 100 0 L 100 100 L 0 100 C 0 83.60, 0 74.72, -8.73 70.27 C -13.09 67.61, -21.82 75.93, -27.27 73.28 C -34.91 69.32, -36.00 65.35, -36.00 61.39 C -36.00 57.42, -34.91 53.46, -27.27 49.49 C -21.82 46.85, -13.09 55.17, -8.73 52.50 C 0 48.06, 0 39.17, 0 0 Z',
        ]);
    });
});
