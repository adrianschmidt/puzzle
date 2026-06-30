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

describe('generateTopologyPuzzle with triangular base cut', () => {
    // Unlike the unit tests in triangular-cut-generator.test.ts (which inspect
    // the raw Curve[]), these run the lattice through the full DCEL builder and
    // assert the result is well-formed: valid M…Z piece shapes, unique piece
    // IDs, and bidirectional edge mates. Mate-consistency is a topological proxy
    // for a sound face set (these tests do not measure area coverage, so they do
    // not directly prove the tiling is gap-free) — the degree-6 vertices a
    // triangular lattice produces are exactly the case a per-curve test can't
    // exercise.
    function triangularConfig(jitter: number): TopologyGeneratorConfig {
        return {
            baseCutGeneratorId: 'triangular',
            baseCutConfig: { jitter },
            tabGeneratorId: 'none',
        };
    }

    it.each([0, 0.15, 0.4])('produces valid pieces through the DCEL pipeline (jitter %s)', (jitter) => {
        const { pieces } = generateTopologyPuzzle(
            6, 6, { width: 600, height: 400 },
            seededRandom(42),
            triangularConfig(jitter),
        );
        expect(pieces.length).toBeGreaterThan(0);
        for (const p of pieces) {
            expect(p.shape).toBeTruthy();
            expect(p.shape.startsWith('M')).toBe(true);
            expect(p.shape.endsWith('Z')).toBe(true);
        }
    });

    it('assigns unique piece IDs and bidirectional mates', () => {
        const { pieces } = generateTopologyPuzzle(
            6, 6, { width: 600, height: 400 },
            seededRandom(7),
            triangularConfig(0.2),
        );
        const ids = new Set(pieces.map((p) => p.id));
        expect(ids.size).toBe(pieces.length);

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

    it('works with classic tabs applied', () => {
        const { pieces } = generateTopologyPuzzle(
            6, 6, { width: 600, height: 400 },
            seededRandom(99),
            { baseCutGeneratorId: 'triangular', baseCutConfig: { jitter: 0.15 }, tabGeneratorId: 'classic' },
        );
        expect(pieces.length).toBeGreaterThan(0);
        for (const p of pieces) {
            expect(p.shape).toBeTruthy();
            expect(p.shape.startsWith('M')).toBe(true);
            expect(p.shape.endsWith('Z')).toBe(true);
        }
    });
});

describe('generateTopologyPuzzle grid-dim clamp (issue #440)', () => {
    // A crafted share link can smuggle an out-of-range `rows`/`cols` into the
    // opaque `baseCutConfig` (the share-link `cf.bgc` blob). The generator must
    // never let that override the clamped grid dims it was handed: a generator
    // that scales its work by `rows`/`cols` (notably sine) would otherwise
    // allocate unbounded cuts and hang the tab. The clamp lives in the shared
    // path so it covers every base-cut generator, not just sine.
    const FLAT_SINE = { ha: 0, hf: 0, va: 0, vf: 0 } as const;

    it('ignores rows/cols smuggled into baseCutConfig (override neutralized)', () => {
        const baseline = generateTopologyPuzzle(
            3, 3, { width: 300, height: 300 }, seededRandom(42),
            { baseCutGeneratorId: 'sine', baseCutConfig: { ...FLAT_SINE }, tabGeneratorId: 'none' },
        ).pieces.length;

        const crafted = generateTopologyPuzzle(
            3, 3, { width: 300, height: 300 }, seededRandom(42),
            {
                baseCutGeneratorId: 'sine',
                // 70 is above MAX_GRID_DIM (64); mimics a crafted `cf.bgc`
                // override. It must not win over the 3×3 grid args.
                baseCutConfig: { ...FLAT_SINE, rows: 70, cols: 70 },
                tabGeneratorId: 'none',
            },
        ).pieces.length;

        expect(baseline).toBe(9);
        expect(crafted).toBe(baseline);
    });

    it('clamps oversized grid args themselves to MAX_GRID_DIM (defense in depth)', () => {
        // The decoder already clamps `g` to 64 upstream; this asserts the
        // generator independently bounds an out-of-range dimension instead of
        // attempting an unbounded grid. A 1000×1000 request must behave exactly
        // like the clamped 64×64 grid, not blow up.
        const clamped = generateTopologyPuzzle(
            1000, 1000, { width: 640, height: 640 }, seededRandom(42),
            { baseCutGeneratorId: 'sine', baseCutConfig: { ...FLAT_SINE }, tabGeneratorId: 'none' },
        ).pieces.length;
        const atCeiling = generateTopologyPuzzle(
            64, 64, { width: 640, height: 640 }, seededRandom(42),
            { baseCutGeneratorId: 'sine', baseCutConfig: { ...FLAT_SINE }, tabGeneratorId: 'none' },
        ).pieces.length;
        expect(clamped).toBe(atCeiling);
    });

    it('an in-range rows/cols in baseCutConfig is inert (no crash, identical geometry)', () => {
        // Companion to the out-of-range case above. The generator overwrites
        // `cols`/`rows` unconditionally, so a `bgc` override is always dropped —
        // this can't distinguish "honored" from "dropped" on its own. What it
        // does prove is that supplying an in-range rows/cols in `baseCutConfig`
        // (a shape a real share link could carry) neither throws nor perturbs
        // the seeded geometry: the pieces are byte-identical to passing no
        // override at all. Together with the override-neutralization test above,
        // this shows a `bgc` rows/cols never affects output, in range or out.
        const withoutOverride = generateTopologyPuzzle(
            4, 5, { width: 400, height: 500 }, seededRandom(7),
            { baseCutGeneratorId: 'sine', baseCutConfig: { ...FLAT_SINE }, tabGeneratorId: 'none' },
        ).pieces.map(p => p.shape);

        const withMatchingOverride = generateTopologyPuzzle(
            4, 5, { width: 400, height: 500 }, seededRandom(7),
            { baseCutGeneratorId: 'sine', baseCutConfig: { ...FLAT_SINE, rows: 5, cols: 4 }, tabGeneratorId: 'none' },
        ).pieces.map(p => p.shape);

        expect(withMatchingOverride).toEqual(withoutOverride);
    });
});
