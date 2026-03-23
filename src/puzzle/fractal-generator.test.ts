import { describe, test, expect } from 'vitest';
import { generateFractalPuzzle } from './fractal-generator.js';

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

    test('handles single piece puzzle', () => {
        const pieces = generateFractalPuzzle(1, 1, { width: 100, height: 100 }, 42);
        
        expect(pieces.length).toBeGreaterThanOrEqual(1);
        
        if (pieces.length === 1) {
            const piece = pieces[0];
            expect(piece.edges.length).toBeGreaterThan(0);
            
            // All edges should be border edges for a single piece
            for (const edge of piece.edges) {
                expect(edge.matePieceId).toBe(-1);
                expect(edge.mateEdgeId).toBe(-1);
            }
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
});