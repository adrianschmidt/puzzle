import { describe, it, expect } from 'vitest';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { buildDCEL } from './dcel.js';
import { analyzeMates } from './mate-detection.js';
import { Curve } from './curve.js';
import type { PieceDefinition } from '../composable/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPipeline(curves: Curve[]): PieceDefinition[] {
    const dcel = buildDCEL({ curves });
    const mates = analyzeMates(dcel);
    return facesToPieceDefinitions(dcel, mates);
}

function makeGrid(cols: number, rows: number, w: number, h: number): Curve[] {
    const curves: Curve[] = [
        // Border
        Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
        Curve.line({ x: w, y: 0 }, { x: w, y: h }),
        Curve.line({ x: w, y: h }, { x: 0, y: h }),
        Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
    ];
    // Horizontal cuts
    for (let r = 1; r < rows; r++) {
        const y = (r / rows) * h;
        curves.push(Curve.line({ x: 0, y }, { x: w, y }));
    }
    // Vertical cuts
    for (let c = 1; c < cols; c++) {
        const x = (c / cols) * w;
        curves.push(Curve.line({ x, y: 0 }, { x, y: h }));
    }
    return curves;
}

// ---------------------------------------------------------------------------
// Single rectangle → 1 piece
// ---------------------------------------------------------------------------

describe('facesToPieceDefinitions: single rectangle', () => {
    it('produces 1 piece', () => {
        const pieces = buildPipeline([
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ]);
        expect(pieces).toHaveLength(1);
    });

    it('has 4 edges, all border', () => {
        const pieces = buildPipeline([
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ]);

        expect(pieces[0].edges).toHaveLength(4);
        for (const edge of pieces[0].edges) {
            expect(edge.mateEdgeId).toBe(-1);
            expect(edge.matePieceId).toBe(-1);
        }
    });

    it('has correct imageOffset', () => {
        const pieces = buildPipeline([
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ]);

        // bbox starts at (0,0), so offset is (0,0)
        expect(pieces[0].imageOffset.x).toBeCloseTo(0, 0);
        expect(pieces[0].imageOffset.y).toBeCloseTo(0, 0);
    });
});

// ---------------------------------------------------------------------------
// 2×2 grid → 4 pieces
// ---------------------------------------------------------------------------

describe('facesToPieceDefinitions: 2×2 grid', () => {
    const curves = makeGrid(2, 2, 100, 100);

    it('produces 4 pieces', () => {
        const pieces = buildPipeline(curves);
        expect(pieces).toHaveLength(4);
    });

    it('assigns unique piece IDs', () => {
        const pieces = buildPipeline(curves);
        const ids = pieces.map(p => p.id);
        expect(new Set(ids).size).toBe(4);
    });

    it('assigns unique edge IDs across all pieces', () => {
        const pieces = buildPipeline(curves);
        const allEdgeIds = pieces.flatMap(p => p.edges.map(e => e.id));
        expect(new Set(allEdgeIds).size).toBe(allEdgeIds.length);
    });

    it('each piece has 4 edges', () => {
        const pieces = buildPipeline(curves);
        for (const piece of pieces) {
            expect(piece.edges).toHaveLength(4);
        }
    });

    it('each piece has 2 shared + 2 border edges', () => {
        const pieces = buildPipeline(curves);
        for (const piece of pieces) {
            const shared = piece.edges.filter(e => e.mateEdgeId !== -1);
            const border = piece.edges.filter(e => e.mateEdgeId === -1);
            expect(shared).toHaveLength(2);
            expect(border).toHaveLength(2);
        }
    });

    it('mate relationships are bidirectional', () => {
        const pieces = buildPipeline(curves);
        const edgeMap = new Map<number, { pieceId: number; edge: typeof pieces[0]['edges'][0] }>();
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                edgeMap.set(edge.id, { pieceId: piece.id, edge });
            }
        }

        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;

                const mate = edgeMap.get(edge.mateEdgeId);
                expect(mate).toBeDefined();
                expect(mate!.pieceId).toBe(edge.matePieceId);
                expect(mate!.edge.mateEdgeId).toBe(edge.id);
                expect(mate!.edge.matePieceId).toBe(piece.id);
            }
        }
    });

    it('shared edges have matching sharedEdgeKey', () => {
        const pieces = buildPipeline(curves);
        const edgeMap = new Map<number, typeof pieces[0]['edges'][0]>();
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                edgeMap.set(edge.id, edge);
            }
        }

        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.mateEdgeId === -1) continue;
                const mate = edgeMap.get(edge.mateEdgeId)!;
                expect(edge.sharedEdgeKey).toBe(mate.sharedEdgeKey);
                expect(edge.isFirstSide).not.toBe(mate.isFirstSide);
            }
        }
    });

    it('edges are in piece-local coordinates', () => {
        const pieces = buildPipeline(curves);
        for (const piece of pieces) {
            // All edge start/end points should be non-negative
            // (relative to piece bbox top-left)
            for (const edge of pieces[0].edges) {
                expect(edge.start.x).toBeGreaterThanOrEqual(-0.5);
                expect(edge.start.y).toBeGreaterThanOrEqual(-0.5);
                expect(edge.end.x).toBeGreaterThanOrEqual(-0.5);
                expect(edge.end.y).toBeGreaterThanOrEqual(-0.5);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// 3×3 grid → 9 pieces
// ---------------------------------------------------------------------------

describe('facesToPieceDefinitions: 3×3 grid', () => {
    const curves = makeGrid(3, 3, 90, 90);

    it('produces 9 pieces', () => {
        const pieces = buildPipeline(curves);
        expect(pieces).toHaveLength(9);
    });

    it('total shared edges = 12', () => {
        const pieces = buildPipeline(curves);
        const allKeys = new Set<string>();
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.sharedEdgeKey) allKeys.add(edge.sharedEdgeKey);
            }
        }
        expect(allKeys.size).toBe(12);
    });

    it('all mate relationships are bidirectional', () => {
        const pieces = buildPipeline(curves);
        const edgeMap = new Map<number, { pieceId: number; mateEdgeId: number; matePieceId: number }>();
        for (const p of pieces) {
            for (const e of p.edges) {
                edgeMap.set(e.id, { pieceId: p.id, mateEdgeId: e.mateEdgeId, matePieceId: e.matePieceId });
            }
        }

        for (const p of pieces) {
            for (const e of p.edges) {
                if (e.mateEdgeId === -1) continue;
                const mate = edgeMap.get(e.mateEdgeId)!;
                expect(mate.mateEdgeId).toBe(e.id);
                expect(mate.matePieceId).toBe(p.id);
                expect(mate.pieceId).toBe(e.matePieceId);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Image offset for non-origin pieces
// ---------------------------------------------------------------------------

describe('facesToPieceDefinitions: image offsets', () => {
    it('bottom-right piece has correct offset', () => {
        const pieces = buildPipeline(makeGrid(2, 2, 100, 100));

        // One of the pieces should have imageOffset near (-50, -50)
        // (the piece in the bottom-right quadrant)
        const bottomRight = pieces.find(p =>
            Math.abs(p.imageOffset.x - (-50)) < 2 &&
            Math.abs(p.imageOffset.y - (-50)) < 2,
        );
        expect(bottomRight).toBeDefined();
    });

    it('top-left piece has offset near (0, 0)', () => {
        const pieces = buildPipeline(makeGrid(2, 2, 100, 100));

        const topLeft = pieces.find(p =>
            Math.abs(p.imageOffset.x) < 2 &&
            Math.abs(p.imageOffset.y) < 2,
        );
        expect(topLeft).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// curvePoints
// ---------------------------------------------------------------------------

describe('facesToPieceDefinitions: curvePoints', () => {
    it('straight edges have no curvePoints (space optimization)', () => {
        const pieces = buildPipeline(makeGrid(2, 2, 100, 100));
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                // Straight grid → no curvePoints needed
                expect(edge.curvePoints).toBeUndefined();
            }
        }
    });
});
