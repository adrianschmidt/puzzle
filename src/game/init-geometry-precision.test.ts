/**
 * Geometry-precision invariants for generated puzzles (#487).
 *
 * `createNewGame` quantizes generated geometry to
 * `GEOMETRY_PRECISION_DECIMALS`, so a generated puzzle's geometry is one set
 * of numbers whether it is held in memory, written to `localStorage`, or
 * regenerated from a share link. (Saves written before the pass existed are
 * not re-rounded on load — the invariant is about geometry this pass
 * produced.) These tests pin that at the seam where it matters — the state
 * the app actually plays and saves — rather than only on the helper.
 *
 * The blob-size guard lives here too: it needs the same real traced
 * generation as the invariants, and generating 192 traced pieces twice would
 * double the slowest part of the file.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createNewGame } from './init.js';
import type { InitOptions } from './init.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';
import type { CutStyle } from './cut-styles.js';
import { GEOMETRY_PRECISION_DECIMALS } from '../model/quantize-geometry.js';
import { serializeStatic } from '../persistence/serialization.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';
import { worstPrecision } from '../test-helpers/precision.js';
import type { GameState, GridSize, Piece } from '../model/types.js';

// Swap the lazy-load stub for the real traced generator so traced generation
// runs synchronously (otherwise the stub throws "not loaded"). Same setup as
// cut-style-strategies.classic-traced.test.ts.
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

// Small grids: precision is a property of every coordinate, so it does not
// need the maximum piece count — and Triangles at 192 takes several seconds.
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
        // The one style whose generator config arrives from the share link
        // rather than from a fixed preset, so its coordinate range is the
        // widest. `hf` is deliberately not a 2-decimal number: config values
        // stay full precision, only the geometry they produce is rounded.
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
 * The pieces the generator hands `createNewGame`, before quantization.
 *
 * Mirrors `createNewGame`'s own `scaleGrid` → `inscribePuzzleSize` →
 * `generatePieces` sequence, which matters for Fractal (whose grid and puzzle
 * rectangle are both derived) — passing the raw grid would compare against a
 * different puzzle.
 */
function generateRaw(style: StyleCase): Piece[] {
    const strategy = getCutStyleStrategy(style.options.cutStyle);
    const grid = strategy.scaleGrid(style.grid, imageSize, style.options);
    const puzzleSize = strategy.inscribePuzzleSize(imageSize, grid, style.options);
    return strategy.generatePieces(grid, puzzleSize, SEED, style.options).pieces;
}

describe('generated geometry precision', () => {
    for (const style of styles) {
        describe(style.name, () => {
            let state: GameState;
            let raw: Piece[];

            beforeAll(() => {
                state = createNewGame('img', imageSize, viewport, style.grid, {
                    ...style.options,
                    seed: SEED,
                });
                raw = generateRaw(style);
            });

            // The walk is generic rather than a list of known coordinate
            // fields: a numeric field added to Edge or Piece later has to fail
            // here without anyone remembering to extend the probe.
            //
            // Only `state.pieces` is walked. `serializeStatic` writes those
            // same pieces verbatim, but its other fields — the inscribed
            // puzzle rectangle, the cut-style config — are deliberately not
            // quantized: the composable case above persists `hf` as
            // 1.3333333333333333, and rounding a generator parameter would
            // change the geometry it produces.
            it(`carries no coordinate finer than ${GEOMETRY_PRECISION_DECIMALS} decimals`, () => {
                expect(state.pieces.length).toBeGreaterThan(0);

                const worst = worstPrecision(state.pieces);

                expect(worst.decimals, `pieces${worst.path} = ${worst.value}`)
                    .toBeLessThanOrEqual(GEOMETRY_PRECISION_DECIMALS);
            });

            // The reason quantization runs on the finished Piece[] rather than
            // where curvePoints are produced: `fmt` already emits toFixed(2),
            // so rounding after composition leaves every rendered path
            // untouched. If this breaks, existing share links render different
            // geometry than they did before.
            it('leaves shape and path strings byte-identical to the raw generator output', () => {
                expect(state.pieces.map((p) => p.shape)).toEqual(raw.map((p) => p.shape));
                expect(state.pieces.flatMap((p) => p.edges.map((e) => e.path))).toEqual(
                    raw.flatMap((p) => p.edges.map((e) => e.path)),
                );
            });
        });
    }
});

/**
 * The plain-write budget, as a tested invariant rather than something we
 * rediscover when `writeWithOverflow` starts falling back to lz-string.
 *
 * Measured in UTF-16 code units — `String.length`, the unit browsers meter
 * `localStorage` in and the unit #399's ceiling was established in. ~4.75 M is
 * the practical ceiling; 4.5 M leaves a deliberate margin. Wavy at 16×12 is
 * the largest blob any production style produces: 5.70 M before quantization,
 * 3.80 M after, measured on a 1080×720 image — the size Unsplash always
 * delivers.
 *
 * The blob is mildly seed-dependent (essentially-straight edges emit no
 * `curvePoints`, and traced tabs vary in segment count), so the single seed
 * below is a sample rather than the distribution. Measured at seeds 1 / 42 /
 * 4242 / 999999: 3.748 M / 3.729 M / 3.799 M / 3.695 M — a ~2.8% spread, with
 * 4242 the widest of the four and ~0.7 M of margin left under the budget.
 */
const PLAIN_WRITE_BUDGET_CHARS = 4.5 * 1024 * 1024;

describe('persisted geometry size', () => {
    it(
        'keeps the largest supported puzzle under the plain-write budget',
        { timeout: 20_000 },
        () => {
            const state = createNewGame('img', imageSize, viewport, { cols: 16, rows: 12 }, {
                cutStyle: 'wavy',
                wavyConfig: { traceSetVersion: 1 },
                seed: SEED,
            });

            const chars = JSON.stringify(serializeStatic(state)).length;

            expect(state.pieces.length).toBe(192);
            expect(chars).toBeLessThan(PLAIN_WRITE_BUDGET_CHARS);
        },
    );
});
