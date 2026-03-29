import { describe, it, expect } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe('generateTopologyPuzzle', () => {
    it('generates correct piece count for a 2×2 grid', () => {
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 100, height: 100 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0, disableTabs: true },
        );
        expect(pieces).toHaveLength(4);
    });

    it('generates correct piece count for a 3×3 grid', () => {
        const pieces = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0, disableTabs: true },
        );
        expect(pieces).toHaveLength(9);
    });

    it('generates correct piece count for a 4×6 grid', () => {
        const pieces = generateTopologyPuzzle(
            4, 6, { width: 400, height: 600 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0, disableTabs: true },
        );
        expect(pieces).toHaveLength(24);
    });

    it('each piece has a valid shape (non-empty SVG path)', () => {
        const pieces = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0, disableTabs: true },
        );
        for (const piece of pieces) {
            expect(piece.shape).toBeTruthy();
            expect(piece.shape.startsWith('M')).toBe(true);
            expect(piece.shape.endsWith('Z')).toBe(true);
        }
    });

    it('assigns unique piece IDs', () => {
        const pieces = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0 },
        );
        const ids = pieces.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('assigns unique edge IDs across all pieces', () => {
        const pieces = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0 },
        );
        const allEdgeIds = pieces.flatMap(p => p.edges.map(e => e.id));
        expect(new Set(allEdgeIds).size).toBe(allEdgeIds.length);
    });

    it('mate relationships are bidirectional', () => {
        const pieces = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0 },
        );
        const edgeMap = new Map<number, { pieceId: number; mateEdgeId: number; matePieceId: number }>();
        for (const p of pieces) {
            for (const e of p.edges) {
                edgeMap.set(e.id, { pieceId: p.id, mateEdgeId: e.mateEdgeId, matePieceId: e.matePieceId });
            }
        }

        for (const p of pieces) {
            for (const e of p.edges) {
                if (e.mateEdgeId === -1) continue;
                const mate = edgeMap.get(e.mateEdgeId);
                expect(mate).toBeDefined();
                expect(mate!.mateEdgeId).toBe(e.id);
                expect(mate!.matePieceId).toBe(p.id);
                expect(mate!.pieceId).toBe(e.matePieceId);
            }
        }
    });

    it('works with wavy cuts (non-zero amplitude)', () => {
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.15, horizontalFrequency: 1.5,
              verticalAmplitude: 0.15, verticalFrequency: 1.5 },
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('works with tabs enabled', () => {
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0, verticalAmplitude: 0, disableTabs: false },
        );
        // Tabs may create additional pieces where they cross other cuts,
        // but should produce at least the base grid count
        expect(pieces.length).toBeGreaterThanOrEqual(4);
        for (const piece of pieces) {
            expect(piece.shape.length).toBeGreaterThan(20);
        }
    });

    it('works with both wavy cuts and tabs', () => {
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.1, horizontalFrequency: 1,
              verticalAmplitude: 0.1, verticalFrequency: 1, disableTabs: false },
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('default config produces valid pieces', () => {
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    // -- Wavy Bézier cut tests (regression for segment-level splitting) ----

    it('wavy 3×2 with freq 1 produces correct piece count', () => {
        const pieces = generateTopologyPuzzle(
            3, 2, { width: 300, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.1, horizontalFrequency: 1,
              verticalAmplitude: 0.1, verticalFrequency: 1, disableTabs: true },
        );
        expect(pieces).toHaveLength(6);
    });

    it('wavy 2×2 with freq 10 produces at least 4 pieces', () => {
        // High-frequency waves may create extra "island" pieces
        // from multiple crossings — at least the base grid count
        const pieces = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.15, horizontalFrequency: 10,
              verticalAmplitude: 0.15, verticalFrequency: 10, disableTabs: true },
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('wavy cuts produce pieces with bidirectional mates', () => {
        const pieces = generateTopologyPuzzle(
            3, 2, { width: 300, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.1, horizontalFrequency: 1,
              verticalAmplitude: 0.1, verticalFrequency: 1, disableTabs: true },
        );
        const edgeMap = new Map<number, { pieceId: number; mateEdgeId: number; matePieceId: number }>();
        for (const p of pieces) {
            for (const e of p.edges) {
                edgeMap.set(e.id, { pieceId: p.id, mateEdgeId: e.mateEdgeId, matePieceId: e.matePieceId });
            }
        }
        for (const p of pieces) {
            for (const e of p.edges) {
                if (e.mateEdgeId === -1) continue;
                const mate = edgeMap.get(e.mateEdgeId);
                expect(mate).toBeDefined();
                expect(mate!.mateEdgeId).toBe(e.id);
                expect(mate!.matePieceId).toBe(p.id);
            }
        }
    });

    it('wavy cuts with tabs produce valid pieces', () => {
        const pieces = generateTopologyPuzzle(
            3, 2, { width: 300, height: 200 },
            seededRandom(42),
            { horizontalAmplitude: 0.1, horizontalFrequency: 1,
              verticalAmplitude: 0.1, verticalFrequency: 1, disableTabs: false },
        );
        expect(pieces.length).toBeGreaterThanOrEqual(6);
        for (const piece of pieces) {
            expect(piece.shape).toBeTruthy();
            expect(piece.shape.startsWith('M')).toBe(true);
        }
    });
});
