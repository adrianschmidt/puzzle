import { describe, it, expect } from 'vitest';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { buildDCEL } from './dcel.js';
import { Curve } from './curve.js';
import { resolveExcessIntersections } from './collision.js';
import type { PieceDefinition } from '../composable/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPipeline(curves: Curve[]): PieceDefinition[] {
    const dcel = buildDCEL({ curves });
    return facesToPieceDefinitions(dcel);
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
        for (const p of pieces) {
            // All edge start/end points should be non-negative
            // (relative to piece bbox top-left)
            for (const edge of p.edges) {
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

// ---------------------------------------------------------------------------
// Lens-face merging (issue #219/#220 — no holes from small faces)
// ---------------------------------------------------------------------------

/**
 * Generate a sine-wave curve (same algorithm as generator.ts).
 */
function generateSineCurve(
    start: { x: number; y: number },
    end: { x: number; y: number },
    amplitude: number,
    frequency: number,
    phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;

    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));

    const bezierPoints: { x: number; y: number }[] = [];

    const evalSine = (t: number) => {
        const angle = 2 * Math.PI * frequency * t + phase;
        const s = amplitude * Math.sin(angle);
        const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
        return {
            x: start.x + t * dx + s * px,
            y: start.y + t * dy + s * py,
            tx: dx + ds * px,
            ty: dy + ds * py,
        };
    };

    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments;
        const t1 = (i + 1) / totalSegments;
        const dt = t1 - t0;

        const p0 = evalSine(t0);
        const p1 = evalSine(t1);

        if (i === 0) {
            bezierPoints.push({ x: p0.x, y: p0.y });
        }
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }

    return Curve.fromBezierPath(bezierPoints);
}

describe('facesToPieceDefinitions: lens-face merging', () => {
    it('merges 2-edge lens faces instead of creating holes', () => {
        // Two close parallel sine waves with opposite phase — creates lenses
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        // Run through excess-intersection resolver (may or may not splice)
        const resolved = resolveExcessIntersections(curves, 4);
        const dcel = buildDCEL({ curves: resolved });
        const pieces = facesToPieceDefinitions(dcel);

        // Every non-border shared edge must have a valid mate piece
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.matePieceId !== -1) {
                    const matePiece = pieces.find(p => p.id === edge.matePieceId);
                    expect(matePiece).toBeDefined();
                    const mateEdge = matePiece!.edges.find(e => e.id === edge.mateEdgeId);
                    expect(mateEdge).toBeDefined();
                    expect(mateEdge!.matePieceId).toBe(piece.id);
                }
            }
        }
    });

    it('no mate references point to non-existent pieces (no holes)', () => {
        // Extreme settings: 6x4 grid, high amplitude, high frequency
        const w = 600;
        const h = 400;
        const cols = 6;
        const rows = 4;
        const amp = 0.5;
        const freq = 12;
        const pieceW = w / cols;
        const pieceH = h / rows;
        const hPixelAmp = (amp * pieceH) / 2;
        const vPixelAmp = (amp * pieceW) / 2;

        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
            Curve.line({ x: w, y: 0 }, { x: w, y: h }),
            Curve.line({ x: w, y: h }, { x: 0, y: h }),
            Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
        ];

        // Seeded phases for reproducibility
        let seed = 42;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        for (let r = 1; r < rows; r++) {
            const y = r * pieceH;
            curves.push(generateSineCurve(
                { x: 0, y }, { x: w, y }, hPixelAmp, freq, rng() * Math.PI * 2,
            ));
        }
        for (let c = 1; c < cols; c++) {
            const x = c * pieceW;
            curves.push(generateSineCurve(
                { x, y: 0 }, { x, y: h }, vPixelAmp, freq, rng() * Math.PI * 2,
            ));
        }

        const resolved = resolveExcessIntersections(curves, 4);
        const dcel = buildDCEL({ curves: resolved });
        const pieces = facesToPieceDefinitions(dcel);

        const pieceIds = new Set(pieces.map(p => p.id));

        // Every mate reference must point to a piece that exists
        for (const piece of pieces) {
            for (const edge of piece.edges) {
                if (edge.matePieceId !== -1) {
                    expect(pieceIds.has(edge.matePieceId)).toBe(true);
                }
            }
        }

        // Should produce at least cols*rows pieces (may be more due to
        // extra intersections, but never fewer — no holes)
        expect(pieces.length).toBeGreaterThanOrEqual(cols * rows);
    });
});
