import { describe, it, expect, vi } from 'vitest';

// Pure mock (not passthrough, unlike the wavy/triangles sibling files) so we
// can assert the exact sine config classicStrategy builds without running
// real traced generation. See reference_vitest_spy_internal_module_call for
// why vi.mock (not vi.spyOn) is needed to intercept the internal call, and
// project_traced_tab_lazy_stub_forwarding for why classic-traced.test.ts is
// split from cut-style-strategies.test.ts: vi.mock is file-scoped, and that
// file's wavy/triangles tests rely on real composable generation.
vi.mock('../puzzle/composable-generator.js', () => ({
    generateComposablePuzzle: vi.fn(() => ({ pieces: [] })),
}));

import { getCutStyleStrategy } from './cut-style-strategies.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';

const mockComposable = vi.mocked(generateComposablePuzzle);

describe('classicStrategy', () => {
    it('uses the sine pipeline with gentle params when classicConfig is set', () => {
        mockComposable.mockClear();
        const strategy = getCutStyleStrategy('classic');
        strategy.generatePieces(
            { cols: 6, rows: 3 },
            { width: 600, height: 300 },
            123,
            { classicConfig: { traceSetVersion: 1 } },
        );
        expect(mockComposable).toHaveBeenCalledWith(
            6, 3, { width: 600, height: 300 }, 123,
            expect.objectContaining({
                baseCutGenerator: 'sine',
                baseCutConfig: expect.objectContaining({
                    cols: 6, rows: 3, ha: 0.11, hf: 2, va: 0.11, vf: 1,
                }),
                tabGenerator: 'traced',
                tabConfig: { traceSetVersion: 1 },
                borderless: false,
            }),
        );
    });

    it('falls back to the legacy generator when classicConfig is absent', () => {
        mockComposable.mockClear();
        const strategy = getCutStyleStrategy('classic');
        const result = strategy.generatePieces(
            { cols: 3, rows: 2 }, { width: 300, height: 200 }, 7, {},
        );
        expect(mockComposable).not.toHaveBeenCalled();
        const legacy = generateProceduralPuzzle(3, 2, { width: 300, height: 200 }, 7);
        expect(result.pieces.map((p) => p.shape)).toEqual(legacy.map((p) => p.shape));
    });

    it('exposes classicConfig as its configKey', () => {
        expect(getCutStyleStrategy('classic').configKey).toBe('classicConfig');
    });
});
