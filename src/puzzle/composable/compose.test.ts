import { describe, it, expect } from 'vitest';
import { composePuzzle } from './compose.js';
import type { PieceDefinition } from './types.js';
import { classicTabTemplate } from './tab-shapes.js';
import { createSeededRandom } from '../seeded-random.js';

/** Create a simple 2x2 grid of piece definitions for testing. */
function make2x2PieceDefs(): PieceDefinition[] {
    // 4 pieces in a 200×200 grid (100×100 each)
    // Shared edges: h_0_0, h_0_1 (horizontal), v_0_0, v_1_0 (vertical)
    let nextId = 0;

    const h00_1 = nextId++; const h00_2 = nextId++;
    const h01_1 = nextId++; const h01_2 = nextId++;
    const v00_1 = nextId++; const v00_2 = nextId++;
    const v10_1 = nextId++; const v10_2 = nextId++;
    // Border edges
    const borders = Array.from({ length: 8 }, () => nextId++);

    return [
        // Piece (0,0) — top-left
        {
            id: 0,
            edges: [
                { id: borders[0], start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
                { id: v00_1, start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: v00_2, matePieceId: 1, sharedEdgeKey: 'v_0_0', isFirstSide: true },
                { id: h00_1, start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: h00_2, matePieceId: 2, sharedEdgeKey: 'h_0_0', isFirstSide: true },
                { id: borders[1], start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
            ],
            imageOffset: { x: 0, y: 0 },
        },
        // Piece (0,1) — top-right
        {
            id: 1,
            edges: [
                { id: borders[2], start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
                { id: borders[3], start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                { id: h01_1, start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: h01_2, matePieceId: 3, sharedEdgeKey: 'h_0_1', isFirstSide: true },
                { id: v00_2, start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: v00_1, matePieceId: 0, sharedEdgeKey: 'v_0_0', isFirstSide: false },
            ],
            imageOffset: { x: -100, y: 0 },
        },
        // Piece (1,0) — bottom-left
        {
            id: 2,
            edges: [
                { id: h00_2, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: h00_1, matePieceId: 0, sharedEdgeKey: 'h_0_0', isFirstSide: false },
                { id: v10_1, start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: v10_2, matePieceId: 3, sharedEdgeKey: 'v_1_0', isFirstSide: true },
                { id: borders[4], start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                { id: borders[5], start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
            ],
            imageOffset: { x: 0, y: -100 },
        },
        // Piece (1,1) — bottom-right
        {
            id: 3,
            edges: [
                { id: h01_2, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: h01_1, matePieceId: 1, sharedEdgeKey: 'h_0_1', isFirstSide: false },
                { id: borders[6], start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                { id: borders[7], start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                { id: v10_2, start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: v10_1, matePieceId: 2, sharedEdgeKey: 'v_1_0', isFirstSide: false },
            ],
            imageOffset: { x: -100, y: -100 },
        },
    ];
}

describe('composePuzzle', () => {
    const template = classicTabTemplate;
    const pieceDefs = make2x2PieceDefs();

    it('produces the correct number of pieces', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        expect(pieces).toHaveLength(4);
    });

    it('each piece has 4 edges', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        for (const piece of pieces) {
            expect(piece.edges).toHaveLength(4);
        }
    });

    it('preserves piece IDs', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        expect(pieces.map(p => p.id).sort()).toEqual([0, 1, 2, 3]);
    });

    it('preserves imageOffset', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        const p0 = pieces.find(p => p.id === 0)!;
        expect(p0.imageOffset).toEqual({ x: 0, y: 0 });
        const p3 = pieces.find(p => p.id === 3)!;
        expect(p3.imageOffset).toEqual({ x: -100, y: -100 });
    });

    it('border edges are straight lines', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        const p0 = pieces.find(p => p.id === 0)!;
        // Top edge (border) should be a straight L command
        const topEdge = p0.edges[0];
        expect(topEdge.mateEdgeId).toBe(-1);
        expect(topEdge.path).toMatch(/^L /);
    });

    it('shared edges have Bézier curves (C commands)', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        const p0 = pieces.find(p => p.id === 0)!;
        // Right edge (shared) should have C commands
        const rightEdge = p0.edges[1];
        expect(rightEdge.mateEdgeId).not.toBe(-1);
        expect(rightEdge.path).toContain('C ');
    });

    it('mate relationships are bidirectional', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        const edgeMap = new Map<number, { pieceId: number; edge: typeof pieces[0]['edges'][0] }>();
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                edgeMap.set(edge.id, { pieceId: piece.id, edge });
            }
        }

        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId !== -1) {
                    const mate = edgeMap.get(edge.mateEdgeId);
                    expect(mate).toBeTruthy();
                    expect(mate!.edge.mateEdgeId).toBe(edge.id);
                    expect(mate!.pieceId).toBe(edge.matePieceId);
                }
            }
        }
    });

    it('each piece has a valid SVG shape', () => {
        const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42));
        for (const piece of pieces) {
            expect(piece.shape).toMatch(/^M /);
            expect(piece.shape).toContain('Z');
        }
    });

    it('is reproducible with the same seed', () => {
        const pieces1 = composePuzzle(pieceDefs, template, createSeededRandom(99));
        const pieces2 = composePuzzle(pieceDefs, template, createSeededRandom(99));
        for (let i = 0; i < pieces1.length; i++) {
            expect(pieces1[i].shape).toBe(pieces2[i].shape);
        }
    });

    it('produces different results with different seeds', () => {
        const pieces1 = composePuzzle(pieceDefs, template, createSeededRandom(1));
        const pieces2 = composePuzzle(pieceDefs, template, createSeededRandom(2));
        // At least one piece should differ
        const differ = pieces1.some((p, i) => p.shape !== pieces2[i].shape);
        expect(differ).toBe(true);
    });

    describe('with disableTabs', () => {
        it('all edges are straight lines when tabs disabled', () => {
            const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42), { disableTabs: true });
            for (const piece of pieces) {
                for (const edge of piece.edges) {
                    expect(edge.path).toMatch(/^L /);
                    expect(edge.path).not.toContain('C ');
                }
            }
        });

        it('mate relationships are preserved when tabs disabled', () => {
            const pieces = composePuzzle(pieceDefs, template, createSeededRandom(42), { disableTabs: true });
            const p0 = pieces.find(p => p.id === 0)!;
            const rightEdge = p0.edges[1];
            expect(rightEdge.mateEdgeId).not.toBe(-1);
            expect(rightEdge.matePieceId).toBe(1);
        });
    });

    describe('inner boundaries', () => {
        it('emits a multi-subpath SVG path for pieces with inner boundaries', () => {
            const pieceDefs: PieceDefinition[] = [{
                id: 0,
                edges: [
                    // outer rectangle 0,0 → 100,0 → 100,100 → 0,100 → 0,0
                    { id: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
                    { id: 1, start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                    { id: 2, start: { x: 100, y: 100 }, end: { x: 0, y: 100 }, mateEdgeId: -1, matePieceId: -1 },
                    { id: 3, start: { x: 0, y: 100 }, end: { x: 0, y: 0 }, mateEdgeId: -1, matePieceId: -1 },
                ],
                innerBoundaries: [[
                    // inner triangle hole: (40,40)→(60,40)→(50,60)→(40,40)
                    { id: 4, start: { x: 40, y: 40 }, end: { x: 60, y: 40 }, mateEdgeId: -1, matePieceId: -1 },
                    { id: 5, start: { x: 60, y: 40 }, end: { x: 50, y: 60 }, mateEdgeId: -1, matePieceId: -1 },
                    { id: 6, start: { x: 50, y: 60 }, end: { x: 40, y: 40 }, mateEdgeId: -1, matePieceId: -1 },
                ]],
                imageOffset: { x: 0, y: 0 },
            }];

            const pieces = composePuzzle(pieceDefs, template, createSeededRandom(1), { disableTabs: true });
            expect(pieces).toHaveLength(1);
            // The shape path should contain two `M ... Z` sub-paths.
            expect(pieces[0].shape).toMatch(/M.*Z.*M.*Z/);
        });
    });
});
