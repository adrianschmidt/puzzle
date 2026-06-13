import { describe, it, expect } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';
import type { TopologyGeneratorConfig } from './generator.js';
import { registerBaseCutGenerator } from './generator-registry.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { Curve } from './curve.js';

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * Build a TopologyGeneratorConfig with sine-grid amplitudes/frequencies
 * and a flag for whether tabs should be applied. Mirrors the legacy
 * config shape so the tests remain readable after the new opaque
 * configuration replaced the per-parameter fields.
 */
function sineConfig(opts: {
    ha?: number;
    hf?: number;
    va?: number;
    vf?: number;
    disableTabs?: boolean;
}): TopologyGeneratorConfig {
    return {
        baseCutGeneratorId: 'sine',
        baseCutConfig: {
            ha: opts.ha ?? 0.15,
            hf: opts.hf ?? 1.5,
            va: opts.va ?? 0.15,
            vf: opts.vf ?? 1.5,
        },
        tabGeneratorId: opts.disableTabs ? 'none' : 'classic',
    };
}

describe('generateTopologyPuzzle', () => {
    it('generates correct piece count for a 2×2 grid', () => {
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 100, height: 100 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0, disableTabs: true }),
        );
        expect(pieces).toHaveLength(4);
    });

    it('generates correct piece count for a 3×3 grid', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0, disableTabs: true }),
        );
        expect(pieces).toHaveLength(9);
    });

    it('generates correct piece count for a 4×6 grid', () => {
        const { pieces } = generateTopologyPuzzle(
            4, 6, { width: 400, height: 600 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0, disableTabs: true }),
        );
        expect(pieces).toHaveLength(24);
    });

    it('each piece has a valid shape (non-empty SVG path)', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0, disableTabs: true }),
        );
        for (const piece of pieces) {
            expect(piece.shape).toBeTruthy();
            expect(piece.shape.startsWith('M')).toBe(true);
            expect(piece.shape.endsWith('Z')).toBe(true);
        }
    });

    it('assigns unique piece IDs', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0 }),
        );
        const ids = pieces.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('assigns unique edge IDs across all pieces', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0 }),
        );
        const allEdgeIds = pieces.flatMap(p => p.edges.map(e => e.id));
        expect(new Set(allEdgeIds).size).toBe(allEdgeIds.length);
    });

    it('mate relationships are bidirectional', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 3, { width: 90, height: 90 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0 }),
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
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 }),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('works with tabs enabled', () => {
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0, va: 0, disableTabs: false }),
        );
        // Tabs may create additional pieces where they cross other cuts,
        // but should produce at least the base grid count
        expect(pieces.length).toBeGreaterThanOrEqual(4);
        for (const piece of pieces) {
            expect(piece.shape.length).toBeGreaterThan(20);
        }
    });

    it('works with both wavy cuts and tabs', () => {
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.1, hf: 1, va: 0.1, vf: 1, disableTabs: false }),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('default config produces valid pieces', () => {
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({}),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    // -- Wavy Bézier cut tests (regression for segment-level splitting) ----

    it('wavy 3×2 with freq 1 produces correct piece count', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 2, { width: 300, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.1, hf: 1, va: 0.1, vf: 1, disableTabs: true }),
        );
        expect(pieces).toHaveLength(6);
    });

    it('wavy 2×2 with freq 10 produces at least 4 pieces', () => {
        // High-frequency waves may create extra "island" pieces
        // from multiple crossings — at least the base grid count
        const { pieces } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.15, hf: 10, va: 0.15, vf: 10, disableTabs: true }),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
    });

    it('wavy cuts produce pieces with bidirectional mates', () => {
        const { pieces } = generateTopologyPuzzle(
            3, 2, { width: 300, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.1, hf: 1, va: 0.1, vf: 1, disableTabs: true }),
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
        const { pieces } = generateTopologyPuzzle(
            3, 2, { width: 600, height: 400 },
            seededRandom(42),
            sineConfig({ ha: 0.1, hf: 1, va: 0.1, vf: 1, disableTabs: false }),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(6);
        for (const piece of pieces) {
            expect(piece.shape).toBeTruthy();
            expect(piece.shape.startsWith('M')).toBe(true);
        }
    });
});

const FRAME = { width: 400, height: 400 };
const rng = () => 0.5;

describe('generateTopologyPuzzle borderless', () => {
    it('bordered 3x3 → 9 pieces', () => {
        const { pieces } = generateTopologyPuzzle(3, 3, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
        });
        expect(pieces.length).toBe(9);
    });

    it('borderless 3x3 → still 9 pieces (oversized to 5x5, ring stripped)', () => {
        const { pieces } = generateTopologyPuzzle(3, 3, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        expect(pieces.length).toBe(9);
    });

    it('borderless 9x1 oversizes both axes (11x3 → strip → 9) not just one', () => {
        // Guards against oversizing only one dimension: 9x1 → (11x3)=33 →
        // strip ring → 9x1 = 9. A one-axis bug would give a different count.
        const { pieces } = generateTopologyPuzzle(9, 1, FRAME, rng, {
            baseCutConfig: { ha: 0, hf: 0, va: 0, vf: 0 }, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        expect(pieces.length).toBe(9);
    });

    it('ignores borderless for a base cut generator without the capability', () => {
        // Register a grid-less fake generator that emits a fixed 2x2 grid and
        // does NOT advertise supportsBorderless. Borderless must be a no-op.
        const fake: BaseCutGenerator = {
            id: 'fake-grid-2x2-no-borderless',
            // no supportsBorderless
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
                Curve.line({ x: 200, y: 0 }, { x: 200, y: 400 }),
            ],
        };
        registerBaseCutGenerator(fake);
        const { pieces } = generateTopologyPuzzle(2, 2, FRAME, rng, {
            baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0,
            borderless: true,
        });
        // 4 pieces, ring NOT stripped (generator doesn't support borderless).
        expect(pieces.length).toBe(4);
    });
});
