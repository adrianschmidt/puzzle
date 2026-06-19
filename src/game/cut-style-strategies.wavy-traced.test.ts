import { describe, it, expect, vi, beforeAll } from 'vitest';

// Passthrough mock so we can inspect the config the wavy strategy builds while
// still running real generation (needed to prove the classic path is unchanged
// and the traced path actually generates). See reference_vitest_spy_internal_module_call.
vi.mock('../puzzle/composable-generator.js', async (importActual) => {
    const actual = await importActual<typeof import('../puzzle/composable-generator.js')>();
    return { ...actual, generateComposablePuzzle: vi.fn(actual.generateComposablePuzzle) };
});

import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously in tests (otherwise the stub throws "not loaded").
beforeAll(() => {
    registerTabGenerator(tracedTabGenerator);
});

const grid = { cols: 6, rows: 4 };
const size = { width: 1080, height: 720 };

describe('wavy strategy tab generator selection', () => {
    it('uses classic tabs when no traceSetVersion is set (legacy reproduction)', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('wavy').generatePieces(grid, size, 12345, {});
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            grid.cols, grid.rows, size, 12345,
            expect.objectContaining({ tabGenerator: 'classic', tabConfig: {} }),
        );
    });

    it('uses traced tabs with the requested version when traceSetVersion is set', () => {
        vi.mocked(generateComposablePuzzle).mockClear();
        getCutStyleStrategy('wavy').generatePieces(grid, size, 12345, {
            wavyConfig: { traceSetVersion: 1 },
        });
        expect(generateComposablePuzzle).toHaveBeenCalledWith(
            grid.cols, grid.rows, size, 12345,
            expect.objectContaining({ tabGenerator: 'traced', tabConfig: { traceSetVersion: 1 } }),
        );
    });

    it('traced wavy is deterministic and differs from classic wavy for the same seed', () => {
        const s = getCutStyleStrategy('wavy');
        const tracedA = s.generatePieces(grid, size, 999, { wavyConfig: { traceSetVersion: 1 } });
        const tracedB = s.generatePieces(grid, size, 999, { wavyConfig: { traceSetVersion: 1 } });
        const classic = s.generatePieces(grid, size, 999, {});
        const shapes = (p: { pieces: { shape: string }[] }) => p.pieces.map((x) => x.shape);
        expect(shapes(tracedB)).toEqual(shapes(tracedA));   // reproducible
        expect(shapes(tracedA)).not.toEqual(shapes(classic)); // traced actually ran
    });
});
