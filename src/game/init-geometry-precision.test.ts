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
import { recombine, serializeProgress, serializeStatic } from '../persistence/serialization.js';
import { registerTabGenerator } from '../puzzle/topology/generator-registry.js';
import { tracedTabGenerator } from '../puzzle/topology/traced-tab-generator.js';
import { worstPrecision } from '../test-helpers/precision.js';
import type { GameState, GeneratedPiece, GridSize } from '../model/types.js';

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
 * How many pieces of each style's blob still carry `shape` after the v12
 * dedup (`serializeStatic` omits `piece.shape` when `buildShape(piece.edges)`
 * reproduces it byte-for-byte — see the design doc referenced below). Keyed by
 * the style-case `name` above rather than `cutStyle`: the two `classic` cases
 * share a `cutStyle` but measure differently, so `cutStyle` alone can't hold
 * both expectations.
 *
 * Exact counts, not "some" — the grids and `SEED` above are fixed, so these
 * are deterministic, and a style degrading from 2 kept pieces to all of them
 * has to fail here rather than pass as "still stored". They are measured
 * values, so a *drop* is fine news that just needs the number updated; a rise
 * means the dedup is losing ground and wants explaining.
 *
 * `classic (sine + traced tabs)` and `composable` are the only two styles that
 * keep any. Root cause, confirmed by direct inspection: a subpath's `M`-anchor
 * coordinate was a near-integer float pre-quantization, so generation-time
 * `fmt` printed e.g. `"229.00"`; quantization's round-to-2dp then folded that
 * float to the exact integer `229`, so rebuilding from the (now-quantized)
 * edge prints `"229"` instead. Numerically identical, byte-different — exactly
 * the case the dedup's per-piece byte check exists to catch safely: those
 * specific pieces just keep their `shape` stored verbatim, per the design's
 * "correctness never depends on the dedup firing." Not a bug.
 *
 * The counts are per grid, not per style: the same `fmt` edge puts 3 of 192
 * wavy pieces in the stored column at the 16×12 production ceiling, where the
 * 6×4 grid below keeps none.
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
 * The pieces the generator hands `createNewGame`, before quantization.
 *
 * Mirrors `createNewGame`'s own `scaleGrid` → `inscribePuzzleSize` →
 * `generatePieces` sequence, which matters for Fractal (whose grid and puzzle
 * rectangle are both derived) — passing the raw grid would compare against a
 * different puzzle.
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

            // The reason quantization runs on the generator's finished
            // GeneratedPiece[] rather than where curvePoints are produced:
            // `fmt` already emits toFixed(2), so rounding after composition
            // leaves every rendered path untouched. If this breaks, existing
            // share links render different geometry than they did before.
            it('leaves shape and path strings byte-identical to the raw generator output', () => {
                expect(state.pieces.map((p) => p.shape)).toEqual(raw.map((p) => p.shape));
                expect(state.pieces.flatMap((p) => p.edges.map((e) => e.path))).toEqual(
                    raw.flatMap((p) => p.edges.map((e) => e.path)),
                );
            });

            // Sealing (model/seal-geometry.ts) runs right after quantization, so
            // every style's generated pieces carry stored bounds and no dangling
            // curve samples. The precision walk above already covers `bounds`
            // itself: min/max of 2 dp values is 2 dp.
            it('seals pieces: bounds present, curve samples dropped', () => {
                for (const piece of state.pieces) {
                    expect(piece.bounds).toBeDefined();
                    for (const edge of piece.edges) {
                        expect('curvePoints' in edge).toBe(false);
                    }
                }
            });

            // Pins how much of the v12 size win each style actually gets, per
            // `piecesKeepingShape` above, so a style silently losing its dedup
            // fails loudly with that style's name and by how much. The message
            // names the pieces, so a 2 → 3 drift points at the new one instead
            // of leaving a count to bisect.
            it('omits shape from the blob for every rebuildable piece', () => {
                const blob = serializeStatic(state);
                const withShape = blob.pieces.filter((p) => 'shape' in p);
                const ids = withShape.map((p) => p.id).join(', ') || 'none';
                expect(withShape.length, `pieces keeping shape: ${ids}`)
                    .toBe(piecesKeepingShape[style.name]);
            });

            // The end-to-end check the dedup rests on. `serializePiece`
            // verifies rebuildability against the *in-memory* edges at save
            // time; the loader rebuilds from *JSON-parsed* ones. Anything that
            // differs across that boundary — number formatting, a dropped
            // field — would silently change the rendered clip-path of every
            // piece whose `shape` was omitted, and nothing else would notice.
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
 * Size guard for the persisted geometry blob (#487/#493 → the v12
 * derived-data removal, `docs/superpowers/specs/2026-07-26-geometry-blob-
 * derived-data-design.md`). Its job has changed: v12 dropped `curvePoints`
 * (stored `bounds` instead) and omits rebuildable `piece.shape`, taking the
 * largest blob from 3,983,820 to 1,207,729 code units (3.80 → 1.15 MiB,
 * re-measured here) — nowhere near the ~4.75 MiB practical `localStorage`
 * ceiling (#399) any more. This guard no longer polices "fits the quota"; it
 * polices "the dedup keeps working." If it ever fails, the
 * right response is to find out why the blob grew back toward its pre-dedup
 * size, not to raise the number.
 *
 * Measured in UTF-16 code units — `String.length`, the unit browsers meter
 * `localStorage` in. Wavy at 16×12 is the largest blob any production style
 * produces, measured on a 1080×720 image — the size Unsplash always
 * delivers.
 *
 * The blob is still mildly seed-dependent, now through the path strings
 * rather than through samples: an edge whose cut curve was sampled emits a
 * per-sample polyline into `edge.path`, while an essentially-straight one
 * emits a single `L` (`composable/compose.ts`'s `fallbackPath`), and traced
 * tabs vary in segment count, which also shifts how often the shape dedup's
 * per-piece byte check verifies. So the single seed below is a sample rather
 * than the distribution. Re-measured at the same
 * seeds #493 used — 1 / 42 / 4242 / 999999: 1.202 M / 1.198 M / 1.208 M /
 * 1.176 M — a ~2.7% spread, with 4242 (the seed used below) the widest of the
 * four. The guard sits ~16% above that measured max: comfortably clear of
 * seed noise, tight enough to catch a real regression.
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
