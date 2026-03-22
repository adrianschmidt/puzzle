import { describe, it, expect } from 'vitest';
import { generateGridPuzzle } from './grid-generator.js';

describe('generateGridPuzzle', () => {
    const cols = 8;
    const rows = 6;
    const imageSize = { width: 800, height: 600 };
    const pieces = generateGridPuzzle(cols, rows, imageSize);

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
        // If edge A mates with edge B on piece P,
        // then edge B on piece P must mate with edge A on the piece that owns A
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

            // Top row pieces should have border top edge
            if (row === 0) {
                expect(top.mateEdgeId).toBe(-1);
                expect(top.matePieceId).toBe(-1);
            } else {
                expect(top.mateEdgeId).not.toBe(-1);
                expect(top.matePieceId).not.toBe(-1);
            }

            // Bottom row
            if (row === rows - 1) {
                expect(bottom.mateEdgeId).toBe(-1);
            } else {
                expect(bottom.mateEdgeId).not.toBe(-1);
            }

            // Left column
            if (col === 0) {
                expect(left.mateEdgeId).toBe(-1);
            } else {
                expect(left.mateEdgeId).not.toBe(-1);
            }

            // Right column
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
            expect(piece.shape).toMatch(/^M /); // starts with moveTo
            expect(piece.shape).toMatch(/ Z$/); // ends with closePath
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
            0,                          // top-left
            cols - 1,                   // top-right
            (rows - 1) * cols,          // bottom-left
            rows * cols - 1,            // bottom-right
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

describe('generateGridPuzzle with different sizes', () => {
    it('works with a small 2×2 grid', () => {
        const pieces = generateGridPuzzle(2, 2, { width: 200, height: 200 });
        expect(pieces).toHaveLength(4);

        // Every piece is a corner → 2 border edges each
        for (const piece of pieces) {
            const borderCount = piece.edges.filter((e) => e.mateEdgeId === -1).length;
            expect(borderCount).toBe(2);
        }
    });

    it('works with a 1×1 grid (single piece)', () => {
        const pieces = generateGridPuzzle(1, 1, { width: 100, height: 100 });
        expect(pieces).toHaveLength(1);

        // All 4 edges are border edges
        const borderCount = pieces[0].edges.filter((e) => e.mateEdgeId === -1).length;
        expect(borderCount).toBe(4);
    });

    it('works with a non-square grid', () => {
        const pieces = generateGridPuzzle(3, 5, { width: 300, height: 500 });
        expect(pieces).toHaveLength(15);
    });
});
