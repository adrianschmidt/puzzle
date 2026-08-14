/**
 * Geometry-precision invariants for generated puzzles (#487). `createNewGame`
 * quantizes geometry to `GEOMETRY_PRECISION_DECIMALS`, so a puzzle reads the
 * same in memory, in `localStorage`, or regenerated from a share link. (Saves
 * predating the pass aren't re-rounded on load.) The blob-size guard co-lives
 * here to reuse the same expensive traced generation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createNewGame } from './init.js';
import type { InitOptions } from './init.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import type { CutStyle } from './cut-styles.js';
import { GEOMETRY_PRECISION_DECIMALS } from '../model/quantize-geometry.js';
import { recombine, serializeProgress, serializeStatic } from '../persistence/serialization.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';
import { worstPrecision } from '../test-helpers/precision.js';
import type { GameState, GeneratedPiece, GridSize } from '../model/types.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously (else the stub throws "not loaded").
beforeAll(() => {
    registerTabGenerator(tracedTabGenerator);
});

const imageSize = { width: 1080, height: 720 };
const viewport = { width: 1200, height: 900 };
const SEED = 4242;

interface StyleCase {
    name: string;
    grid: GridSize;
    options: InitOptions & { cutStyle: CutStyle };
}

// Small grids: precision is per-coordinate, so max piece count isn't needed
// (and Triangles at 192 takes seconds).
const styles: StyleCase[] = [
    {
        name: 'classic (sine + traced tabs)',
        grid: { cols: 6, rows: 3 },
        options: { cutStyle: 'classic', classicConfig: { traceSetVersion: 1 } },
    },
    {
        name: 'classic (legacy generator)',
        grid: { cols: 6, rows: 3 },
        options: { cutStyle: 'classic' },
    },
    {
        name: 'wavy',
        grid: { cols: 6, rows: 4 },
        options: { cutStyle: 'wavy', wavyConfig: { traceSetVersion: 1 } },
    },
    {
        name: 'triangles',
        grid: { cols: 4, rows: 3 },
        options: { cutStyle: 'triangles', trianglesConfig: { traceSetVersion: 1 } },
    },
    {
        name: 'fractal',
        grid: { cols: 6, rows: 4 },
        options: { cutStyle: 'fractal', fractalConfig: {} },
    },
    {
        // Config arrives from the share link (widest coordinate range). `hf` is
        // deliberately not 2-decimal: config stays full precision, only the
        // geometry it produces is rounded.
        name: 'composable',
        grid: { cols: 6, rows: 4 },
        options: {
            cutStyle: 'composable',
            composableConfig: {
                baseCutGenerator: 'sine',
                baseCutConfig: { cols: 6, rows: 4, ha: 0.4, hf: 4 / 3, va: 0.4, vf: 1 },
                tabGenerator: 'classic',
            },
        },
    },
];

/**
 * Pieces of each style's blob that still carry `shape` after the v12 dedup
 * (`serializeStatic` omits `piece.shape` when `buildShape(piece.edges)`
 * reproduces it byte-for-byte). Keyed by style-case `name`, not `cutStyle`:
 * the two `classic` cases share a `cutStyle` but measure differently.
 *
 * Exact deterministic counts (grids + `SEED` fixed): a drop just needs the
 * number updated; a rise means the dedup is losing ground. The kept pieces
 * have an `M`-anchor near-integer float that `fmt` printed as e.g. `"229.00"`
 * pre-quantization but rebuilds as `"229"` after — numerically identical,
 * byte-different, exactly what the per-piece byte check catches safely.
 */
const piecesKeepingShape: Record<string, number> = {
    'classic (sine + traced tabs)': 1,  // of 18
    'classic (legacy generator)': 0,    // of 18
    wavy: 0,                            // of 24
    triangles: 0,                       // of 14
    fractal: 0,                         // of 22
    composable: 2,                      // of 24
};

/**
 * The pieces the generator hands `createNewGame`, before quantization. Mirrors
 * its `scaleGrid` → `inscribePuzzleSize` → `generatePieces` sequence, which
 * matters for Fractal (derived grid) — the raw grid would compare a different
 * puzzle.
 */
function generateRaw(style: StyleCase): GeneratedPiece[] {
    const strategy = getCutStyleStrategy(style.options.cutStyle);
    const grid = strategy.scaleGrid(style.grid, imageSize, style.options);
    const puzzleSize = strategy.inscribePuzzleSize(imageSize, grid, style.options);
    return strategy.generatePieces(grid, puzzleSize, SEED, style.options).pieces;
}

describe('generated geometry precision', () => {
    for (const style of styles) {
        describe(style.name, () => {
            let state: GameState;
            let raw: GeneratedPiece[];

            beforeAll(() => {
                state = createNewGame('img', imageSize, viewport, style.grid, {
                    ...style.options,
                    seed: SEED,
                });
                raw = generateRaw(style);
            });

            // Generic walk (not a fixed field list) so a numeric field added to
            // Edge/Piece later fails here automatically. Only `state.pieces` is
            // walked: the config (e.g. composable `hf` = 1.333…) is deliberately
            // not quantized, since rounding a generator parameter changes geometry.
            it(`carries no coordinate finer than ${GEOMETRY_PRECISION_DECIMALS} decimals`, () => {
                expect(state.pieces.length).toBeGreaterThan(0);

                const worst = worstPrecision(state.pieces);

                expect(worst.decimals, `pieces${worst.path} = ${worst.value}`)
                    .toBeLessThanOrEqual(GEOMETRY_PRECISION_DECIMALS);
            });

            // Quantization runs on the finished GeneratedPiece[] (not at
            // curvePoints): `fmt` already emits toFixed(2), so rounding after
            // composition leaves rendered paths untouched. If this breaks,
            // existing share links render different geometry.
            it('leaves shape and path strings byte-identical to the raw generator output', () => {
                expect(state.pieces.map((p) => p.shape)).toEqual(raw.map((p) => p.shape));
                expect(state.pieces.flatMap((p) => p.edges.map((e) => e.path))).toEqual(
                    raw.flatMap((p) => p.edges.map((e) => e.path)),
                );
            });

            // Sealing (model/seal-geometry.ts) runs after quantization, so pieces
            // carry stored bounds and no dangling curve samples.
            it('seals pieces: bounds present, curve samples dropped', () => {
                for (const piece of state.pieces) {
                    expect(piece.bounds).toBeDefined();
                    for (const edge of piece.edges) {
                        expect('curvePoints' in edge).toBe(false);
                    }
                }
            });

            // Fails loudly with the style name if a style loses its dedup; the
            // message names the kept pieces so a drift points at the new one.
            it('omits shape from the blob for every rebuildable piece', () => {
                const blob = serializeStatic(state);
                const withShape = blob.pieces.filter((p) => 'shape' in p);
                const ids = withShape.map((p) => p.id).join(', ') || 'none';
                expect(withShape.length, `pieces keeping shape: ${ids}`)
                    .toBe(piecesKeepingShape[style.name]);
            });

            // End-to-end check the dedup rests on: `serializePiece` verifies
            // rebuildability against in-memory edges, but the loader rebuilds
            // from JSON-parsed ones. A difference across that boundary would
            // silently change the clip-path of every shape-omitted piece.
            it('restores byte-identical shapes through save → JSON → load', () => {
                const blob = JSON.parse(JSON.stringify(serializeStatic(state)));
                const progress = JSON.parse(JSON.stringify(serializeProgress(state)));

                const restored = recombine(blob, progress);

                expect(restored.pieces.map((p) => p.shape))
                    .toEqual(state.pieces.map((p) => p.shape));
                expect(restored.pieces.map((p) => p.bounds))
                    .toEqual(state.pieces.map((p) => p.bounds));
            });
        });
    }
});

/**
 * Size guard for the persisted geometry blob (#487/#493, v12 derived-data
 * removal). v12 dropped `curvePoints` and omits rebuildable `piece.shape`,
 * taking the largest blob to ~1.15 MiB — well under the ~4.75 MiB localStorage
 * ceiling (#399). So this no longer polices "fits the quota" but "the dedup
 * keeps working": a failure means the blob grew back, don't just raise the number.
 *
 * Measured in UTF-16 code units (`String.length`, the unit localStorage meters).
 * Wavy at 16×12 on a 1080×720 image is the largest production blob. Mildly
 * seed-dependent (~2.7% spread over seeds 1/42/4242/999999); the guard sits
 * ~16% above the measured max.
 */
const SIZE_GUARD_CHARS = 1_400_000;

describe('persisted geometry size', () => {
    it(
        "keeps the largest supported puzzle's blob within the shape-dedup size guard",
        { timeout: 20_000 },
        () => {
            const state = createNewGame('img', imageSize, viewport, { cols: 16, rows: 12 }, {
                cutStyle: 'wavy',
                wavyConfig: { traceSetVersion: 1 },
                seed: SEED,
            });

            const chars = JSON.stringify(serializeStatic(state)).length;

            expect(state.pieces.length).toBe(192);
            expect(chars).toBeLessThan(SIZE_GUARD_CHARS);
        },
    );
});
