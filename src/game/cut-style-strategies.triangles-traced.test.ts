import { describe, it, expect, vi, beforeAll } from 'vitest';

// Passthrough mock so we can inspect the config the triangles strategy builds
// while still running real generation. See reference_vitest_spy_internal_module_call.
vi.mock('../puzzle/composable-generator.js', async (importActual) => {
    const actual = await importActual<typeof import('../puzzle/composable-generator.js')>();
    return { ...actual, generateComposablePuzzle: vi.fn(actual.generateComposablePuzzle) };
});

import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { createNewGame } from './init.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously in tests (otherwise the stub throws "not loaded").
beforeAll(() => {
    registerTabGenerator(tracedTabGenerator);
});

const size = { width: 1080, height: 720 };

// Every test here runs real traced generation with the deep tab ladder,
// ~2-3s per puzzle on CI runners — more than vitest's 5s default allows for
// the multi-generation tests (same idiom as tab-rejection-measurement.test.ts).
describe('triangles strategy generation', { timeout: 30_000 }, () => {
    it('builds the fixed production config (jitter 0.5, smooth, traced, no minPieceArea)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('triangles').generatePieces({ cols: 6, rows: 3 }, size, 12345, {
            trianglesConfig: { traceSetVersion: 1 },
        });
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            6, 3, size, 12345,
            expect.objectContaining({
                baseCutGenerator: 'triangular',
                baseCutConfig: { jitter: 0.5, smooth: true },
                tabGenerator: 'traced',
                tabConfig: { traceSetVersion: 1 },
            }),
        );
        const cfg = vi.mocked(generateComposablePuzzle).mock.calls[0][4]!;
        expect('minPieceArea' in cfg).toBe(false);
        expect(cfg.borderless ?? false).toBe(false);
    });

    it('defaults the trace-set version when the config lost it (crafted link)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('triangles').generatePieces({ cols: 6, rows: 3 }, size, 12345, {});
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            6, 3, size, 12345,
            expect.objectContaining({ tabGenerator: 'traced', tabConfig: { traceSetVersion: 1 } }),
        );
    });

    it('is deterministic for the same seed', () => {
        const s = getCutStyleStrategy('triangles');
        const ctx = { trianglesConfig: { traceSetVersion: 1 } };
        const a = s.generatePieces({ cols: 6, rows: 3 }, size, 999, ctx);
        const b = s.generatePieces({ cols: 6, rows: 3 }, size, 999, ctx);
        expect(b.pieces.map((p) => p.shape)).toEqual(a.pieces.map((p) => p.shape));
    });

    it('piece count lands near the size target', () => {
        const s = getCutStyleStrategy('triangles');
        const grid = s.scaleGrid({ cols: 8, rows: 6 }, size, {});
        const { pieces } = s.generatePieces(grid, size, 7, { trianglesConfig: { traceSetVersion: 1 } });
        expect(pieces.length).toBeGreaterThan(48 * 0.7);
        expect(pieces.length).toBeLessThan(48 * 1.4);
    });

    it('createNewGame stores trianglesConfig and keeps the user-facing grid', () => {
        const state = createNewGame('img', size, { width: 800, height: 600 }, { cols: 6, rows: 4 }, {
            cutStyle: 'triangles',
            trianglesConfig: { traceSetVersion: 1 },
            seed: 1,
        });
        expect(state.trianglesConfig).toEqual({ traceSetVersion: 1 });
        expect(state.cutStyle).toBe('triangles');
        expect(state.gridSize).toEqual({ cols: 6, rows: 4 }); // user grid, not the scaled one
    });
});
