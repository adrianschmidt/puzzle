import { describe, it, expect } from 'vitest';
import { analyzeMates, verifyMateConsistency } from './mate-detection.js';
import { buildDCEL } from './dcel.js';
import { Curve } from './curve.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function innerFaceCount(dcel: ReturnType<typeof buildDCEL>): number {
    return dcel.faces.filter(f => !f.isOuter).length;
}

// ---------------------------------------------------------------------------
// 2×2 grid: 4 pieces, 4 internal edges
// ---------------------------------------------------------------------------

describe('mate detection: 2×2 grid', () => {
    function build2x2() {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),      // top border
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),  // right border
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),  // bottom border
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),      // left border
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),    // horizontal cut
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 }),    // vertical cut
        ];
        const dcel = buildDCEL({ curves });
        return { dcel, analysis: analyzeMates(dcel) };
    }

    it('finds 4 inner faces', () => {
        const { dcel } = build2x2();
        expect(innerFaceCount(dcel)).toBe(4);
    });

    it('finds 4 shared edges (each counted twice = 8 mate entries)', () => {
        const { analysis } = build2x2();
        // Each shared edge appears in 2 mate entries (one per face)
        expect(analysis.matesByKey.size).toBe(4);
        // Total mate entries = 4 shared edges × 2 sides = 8
        expect(analysis.mates).toHaveLength(8);
    });

    it('each face has exactly 2 shared edges', () => {
        const { dcel, analysis } = build2x2();
        const innerFaces = dcel.faces.filter(f => !f.isOuter);
        for (const face of innerFaces) {
            const faceMates = analysis.matesByFace.get(face.id) ?? [];
            expect(faceMates).toHaveLength(2);
        }
    });

    it('each face has exactly 2 border edges', () => {
        const { dcel, analysis } = build2x2();
        const innerFaces = dcel.faces.filter(f => !f.isOuter);
        for (const face of innerFaces) {
            const faceBorders = analysis.bordersByFace.get(face.id) ?? [];
            expect(faceBorders).toHaveLength(2);
        }
    });

    it('mates are bidirectional', () => {
        const { analysis } = build2x2();
        const errors = verifyMateConsistency(analysis);
        expect(errors).toHaveLength(0);
    });

    it('total edges per face = 4 (2 shared + 2 border)', () => {
        const { dcel, analysis } = build2x2();
        const innerFaces = dcel.faces.filter(f => !f.isOuter);
        for (const face of innerFaces) {
            const mateCount = (analysis.matesByFace.get(face.id) ?? []).length;
            const borderCount = (analysis.bordersByFace.get(face.id) ?? []).length;
            expect(mateCount + borderCount).toBe(4);
        }
    });
});

// ---------------------------------------------------------------------------
// Single rectangle: 1 face, all border edges
// ---------------------------------------------------------------------------

describe('mate detection: single rectangle', () => {
    it('has 0 shared edges and 4 border edges', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);

        expect(analysis.mates).toHaveLength(0);
        expect(analysis.borders).toHaveLength(4);
        expect(analysis.matesByKey.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Horizontal cut: 2 faces, 1 shared edge
// ---------------------------------------------------------------------------

describe('mate detection: horizontal cut', () => {
    it('finds 1 shared edge between 2 faces', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);

        expect(analysis.matesByKey.size).toBe(1);
        expect(analysis.mates).toHaveLength(2); // one per face

        // Verify the shared edge connects the two inner faces
        const [pair] = [...analysis.matesByKey.values()];
        expect(pair[0].face).not.toBe(pair[1].face);
        expect(pair[0].mateFace).toBe(pair[1].face);
        expect(pair[1].mateFace).toBe(pair[0].face);
    });

    it('each face has 1 shared edge and 3 border edges', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);
        const innerFaces = dcel.faces.filter(f => !f.isOuter);

        for (const face of innerFaces) {
            expect(analysis.matesByFace.get(face.id)).toHaveLength(1);
            expect(analysis.bordersByFace.get(face.id)).toHaveLength(3);
        }
    });
});

// ---------------------------------------------------------------------------
// 3×3 grid: 9 faces, 12 shared edges
// ---------------------------------------------------------------------------

describe('mate detection: 3×3 grid', () => {
    it('finds 12 shared edges', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 90, y: 0 }),
            Curve.line({ x: 90, y: 0 }, { x: 90, y: 90 }),
            Curve.line({ x: 90, y: 90 }, { x: 0, y: 90 }),
            Curve.line({ x: 0, y: 90 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 30 }, { x: 90, y: 30 }),
            Curve.line({ x: 0, y: 60 }, { x: 90, y: 60 }),
            Curve.line({ x: 30, y: 0 }, { x: 30, y: 90 }),
            Curve.line({ x: 60, y: 0 }, { x: 60, y: 90 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);

        // 3×3 grid has 12 internal edges:
        // 6 horizontal (3 rows × 2 cuts) + 6 vertical (3 cols × 2 cuts)
        // Actually: 2 horizontal cuts × 3 segments each = 6 horizontal edges
        //           2 vertical cuts × 3 segments each = 6 vertical edges
        //           Total = 12 shared edges
        expect(analysis.matesByKey.size).toBe(12);
    });

    it('passes consistency check', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 90, y: 0 }),
            Curve.line({ x: 90, y: 0 }, { x: 90, y: 90 }),
            Curve.line({ x: 90, y: 90 }, { x: 0, y: 90 }),
            Curve.line({ x: 0, y: 90 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 30 }, { x: 90, y: 30 }),
            Curve.line({ x: 0, y: 60 }, { x: 90, y: 60 }),
            Curve.line({ x: 30, y: 0 }, { x: 30, y: 90 }),
            Curve.line({ x: 60, y: 0 }, { x: 60, y: 90 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);
        expect(verifyMateConsistency(analysis)).toHaveLength(0);
    });

    it('corner pieces have 2 border + 2 shared edges', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 90, y: 0 }),
            Curve.line({ x: 90, y: 0 }, { x: 90, y: 90 }),
            Curve.line({ x: 90, y: 90 }, { x: 0, y: 90 }),
            Curve.line({ x: 0, y: 90 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 30 }, { x: 90, y: 30 }),
            Curve.line({ x: 0, y: 60 }, { x: 90, y: 60 }),
            Curve.line({ x: 30, y: 0 }, { x: 30, y: 90 }),
            Curve.line({ x: 60, y: 0 }, { x: 60, y: 90 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);
        const innerFaces = dcel.faces.filter(f => !f.isOuter);

        // Count edge types per face
        const edgeStats = innerFaces.map(face => ({
            shared: (analysis.matesByFace.get(face.id) ?? []).length,
            border: (analysis.bordersByFace.get(face.id) ?? []).length,
        }));

        // 4 corner pieces: 2 shared + 2 border
        const corners = edgeStats.filter(s => s.border === 2 && s.shared === 2);
        expect(corners).toHaveLength(4);

        // 4 edge pieces: 1 border + 3 shared
        const edges = edgeStats.filter(s => s.border === 1 && s.shared === 3);
        expect(edges).toHaveLength(4);

        // 1 centre piece: 0 border + 4 shared
        const centres = edgeStats.filter(s => s.border === 0 && s.shared === 4);
        expect(centres).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Shared edge key: first/second side
// ---------------------------------------------------------------------------

describe('mate detection: first/second side', () => {
    it('each shared edge has exactly one first side and one second side', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 }),
        ];

        const dcel = buildDCEL({ curves });
        const analysis = analyzeMates(dcel);

        for (const [_key, pair] of analysis.matesByKey) {
            const firstSides = pair.filter(m => m.isFirstSide);
            const secondSides = pair.filter(m => !m.isFirstSide);
            expect(firstSides).toHaveLength(1);
            expect(secondSides).toHaveLength(1);
        }
    });
});
