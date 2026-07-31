import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';
import type { TopologyGeneratorConfig } from './generator.js';
import { getBaseCutGenerator, registerBaseCutGenerator, registerTabGenerator } from './generator-registry.js';
import type { BaseCutGenerator, TabGenerator } from './plugin-types.js';
import { Curve } from './curve.js';
import { diagnostics } from '../../diagnostics.js';

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
        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, { width: 200, height: 200 },
            seededRandom(42),
            sineConfig({ ha: 0.15, hf: 10, va: 0.15, vf: 10, disableTabs: true }),
        );
        expect(pieces.length).toBeGreaterThanOrEqual(4);
        // This IS a real piece-count mismatch, and a legitimate one, not a
        // fused-piece bug: at this frequency the sine cuts self-intersect and
        // carve extra "island" faces, so the DCEL genuinely yields more faces
        // than cols x rows predicts. Pinned rather than left to fire
        // unasserted, so a change to this extreme-config behavior is caught
        // here instead of showing up as incidental console noise.
        //
        // `actual: 6` is an island-face count straight out of bezier-js's
        // curve intersections, which makes this a geometry tripwire in the
        // sense `dcel-broad-phase-equivalence.test.ts` describes. If it goes
        // red, work out what moved generated geometry — a bezier-js bump, a
        // change to the cut or DCEL code — and decide whether to take it. Do
        // NOT re-record it to whatever the run produced.
        expect(pieceCountMismatch).toEqual({ expected: 4, actual: 6, baseCutId: 'sine' });
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

describe('generateTopologyPuzzle deep-resolution gating', () => {
    // A fake tab generator that records the opaque config it is handed, so we
    // can assert the deepResolve flag is threaded through the real generator
    // path (not by reading generator internals). Applies no tabs.
    function recordingTabGenerator(id: string, sink: { config?: unknown }): TabGenerator {
        return {
            id,
            generate: () => null,
            generateVariants: (_edge, _random, config) => {
                sink.config = config;
                return [];
            },
        };
    }

    it('sets deepResolve for the triangular base cut', () => {
        const sink: { config?: unknown } = {};
        registerTabGenerator(recordingTabGenerator('test-record-triangular', sink));
        generateTopologyPuzzle(6, 6, { width: 600, height: 600 }, seededRandom(42), {
            baseCutGeneratorId: 'triangular',
            baseCutConfig: { jitter: 0.1 },
            tabGeneratorId: 'test-record-triangular',
        });
        expect((sink.config as { deepResolve?: unknown }).deepResolve).toBe(true);
    });

    it('does not set deepResolve for a non-triangular base cut', () => {
        const sink: { config?: unknown } = {};
        registerTabGenerator(recordingTabGenerator('test-record-sine', sink));
        generateTopologyPuzzle(6, 6, { width: 600, height: 600 }, seededRandom(42), {
            baseCutGeneratorId: 'sine',
            baseCutConfig: { ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5 },
            tabGeneratorId: 'test-record-sine',
        });
        expect((sink.config as { deepResolve?: unknown } | undefined)?.deepResolve).not.toBe(true);
    });
});

describe('generateTopologyPuzzle piece-count invariant', () => {
    it('reports a mismatch when a generator produces fewer faces than it declared', () => {
        // Declares a 2x2 grid but emits only the horizontal internal cut, so
        // the DCEL extracts 2 faces, not 4. This is the shape of the real
        // failure mode (a missed cut crossing fusing faces) without depending
        // on a bug that is now fixed.
        const fake: BaseCutGenerator = {
            id: 'fake-declares-4-emits-2',
            expectedPieceCount: () => 4,
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
            ],
        };
        registerBaseCutGenerator(fake);

        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieces).toHaveLength(2);
        expect(pieceCountMismatch).toEqual({
            expected: 4,
            actual: 2,
            baseCutId: 'fake-declares-4-emits-2',
        });
    });

    it('reports nothing when the declared count matches', () => {
        const fake: BaseCutGenerator = {
            id: 'fake-declares-4-emits-4',
            expectedPieceCount: () => 4,
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

        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieces).toHaveLength(4);
        expect(pieceCountMismatch).toBeUndefined();
    });

    it('exempts a generator that declares no expected count', () => {
        // Same 2-face output as the mismatch case, but no hook -> no report.
        const fake: BaseCutGenerator = {
            id: 'fake-no-expectation',
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
            ],
        };
        registerBaseCutGenerator(fake);

        const { pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(pieceCountMismatch).toBeUndefined();
    });

    it.each(['venn', 'triangular'])(
        'exempts the real %s generator, which declares no count',
        (baseCutGeneratorId) => {
            // These legitimately produce counts unrelated to cols x rows. If
            // someone later adds an expectedPieceCount to either, this test
            // goes red and forces them to prove the derivation is right.
            expect(getBaseCutGenerator(baseCutGeneratorId).expectedPieceCount)
                .toBeUndefined();
        },
    );

    it('compares against the pre-strip count in borderless mode', () => {
        // The sine grid oversizes to 4x4 = 16 faces, then the strip removes the
        // outer ring leaving 4 pieces. The check must see 16 vs 16, not 4 vs 16.
        const { pieces, pieceCountMismatch } = generateTopologyPuzzle(
            2, 2, FRAME, rng,
            { baseCutGeneratorId: 'sine', tabGeneratorId: 'none', minPieceArea: 0,
              baseCutConfig: { cols: 2, rows: 2 }, borderless: true },
        );

        expect(pieces).toHaveLength(4);
        expect(pieceCountMismatch).toBeUndefined();
    });
});

/**
 * The `diagnostics.warn` the check emits alongside the returned
 * `PieceCountMismatch`. Worth its own coverage: on a local `npm run dev` it is
 * the only signal a developer sees (the Umami event needs a website ID), so a
 * transposed `cols`/`rows` or a dropped borderless arm would degrade it
 * silently. Both cases below go red on exactly those mutations.
 */
describe('generateTopologyPuzzle piece-count warning', () => {
    function spyOnWarn() {
        return vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
    }
    let warn: ReturnType<typeof spyOnWarn> | undefined;

    afterEach(() => {
        // `diagnostics` is a module singleton shared with every other test in
        // this file, and `vite.config.ts` sets no `restoreMocks` — restore
        // explicitly rather than leaving a stubbed warn installed.
        warn?.mockRestore();
        warn = undefined;
    });

    /** Border plus one horizontal cut: two faces, whatever grid is declared. */
    const twoFaceCurves = () => [
        Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
        Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
        Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
        Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
        Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
    ];

    it('names the generator, both counts and the requested grid', () => {
        const fake: BaseCutGenerator = {
            id: 'fake-warns-plain',
            expectedPieceCount: () => 6,
            generate: twoFaceCurves,
        };
        registerBaseCutGenerator(fake);
        warn = spyOnWarn();

        // 3x2, not a square grid: a transposed `cols`/`rows` in the message
        // would otherwise read identically.
        generateTopologyPuzzle(
            3, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[piece-count] fake-warns-plain: expected 6 pieces, got 2 '
            + '(requested grid 3x2)',
        );
    });

    it('says so when the expectation counts an oversized borderless grid', () => {
        // The user grid and the counted grid legitimately disagree under
        // borderless, so the message has to say which is which — otherwise
        // "16x12 … expected 252" reads as arithmetic nonsense. This fake
        // declares 99 against a real 4x4 layout purely to force the branch.
        const fake: BaseCutGenerator = {
            id: 'fake-warns-borderless',
            supportsBorderless: true,
            expectedPieceCount: () => 99,
            generate: () => [
                Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
                Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
                Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
                Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
                Curve.line({ x: 0, y: 100 }, { x: 400, y: 100 }),
                Curve.line({ x: 0, y: 200 }, { x: 400, y: 200 }),
                Curve.line({ x: 0, y: 300 }, { x: 400, y: 300 }),
                Curve.line({ x: 100, y: 0 }, { x: 100, y: 400 }),
                Curve.line({ x: 200, y: 0 }, { x: 200, y: 400 }),
                Curve.line({ x: 300, y: 0 }, { x: 300, y: 400 }),
            ],
        };
        registerBaseCutGenerator(fake);
        warn = spyOnWarn();

        generateTopologyPuzzle(
            3, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0,
              borderless: true },
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[piece-count] fake-warns-borderless: expected 99 pieces, got 16 '
            + "(requested grid 3x2, borderless — expected counts the generator's"
            + ' oversized grid, pre-strip)',
        );
    });

    it('stays silent when the declared count matches', () => {
        const fake: BaseCutGenerator = {
            id: 'fake-warns-never',
            expectedPieceCount: () => 2,
            generate: twoFaceCurves,
        };
        registerBaseCutGenerator(fake);
        warn = spyOnWarn();

        generateTopologyPuzzle(
            3, 2, FRAME, rng,
            { baseCutGeneratorId: fake.id, tabGeneratorId: 'none', minPieceArea: 0 },
        );

        expect(warn).not.toHaveBeenCalled();
    });
});
