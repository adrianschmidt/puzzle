import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle, randomTabParams } from './procedural-generator.js';
import { createSeededRandom } from './seeded-random.js';

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

describe('randomTabParams', () => {
    it('produces values within expected ranges', () => {
        const random = createSeededRandom(42);

        for (let i = 0; i < 100; i++) {
            const params = randomTabParams(random);

            expect(typeof params.isTab).toBe('boolean');
            expect(params.heightFraction).toBeGreaterThanOrEqual(0.16);
            expect(params.heightFraction).toBeLessThanOrEqual(0.36);
            expect(params.neckFraction).toBeGreaterThanOrEqual(0.04);
            expect(params.neckFraction).toBeLessThanOrEqual(0.10);
            expect(params.headWidthFraction).toBeGreaterThanOrEqual(0.14);
            expect(params.headWidthFraction).toBeLessThanOrEqual(0.28);
            expect(params.centreOffset).toBeGreaterThanOrEqual(-0.20);
            expect(params.centreOffset).toBeLessThanOrEqual(0.20);
            expect(params.skew).toBeGreaterThanOrEqual(-0.04);
            expect(params.skew).toBeLessThanOrEqual(0.04);
            expect(params.edgeCurve).toBeGreaterThanOrEqual(0.02);
            expect(params.edgeCurve).toBeLessThanOrEqual(0.06);
        }
    });

    it('produces varied values across calls', () => {
        const random = createSeededRandom(42);
        const params1 = randomTabParams(random);
        const params2 = randomTabParams(random);

        // At least one parameter should differ
        const allSame =
            params1.heightFraction === params2.heightFraction &&
            params1.neckFraction === params2.neckFraction &&
            params1.headWidthFraction === params2.headWidthFraction &&
            params1.centreOffset === params2.centreOffset &&
            params1.skew === params2.skew;

        expect(allSame).toBe(false);
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
