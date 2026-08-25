import { describe, it, expect, beforeAll } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import type { ComposableConfig } from '../composable-generator.js';
import { preloadTracedTabGenerator } from './traced-tab-loader.js';

/**
 * Byte-identity guard for traced-tab geometry (#574).
 *
 * The frozen trace-set JSONs pin the traced generator's inputs, but the
 * spliced piece paths also depend on the splice/placement math
 * (`spliceSmoothedFromPath`, `alignTangentsAtSplice`, the empirical
 * `SPLICE_SMOOTHING_RAMP`) and on bezier-js numerics in the variant
 * ladder's crossing checks — none of which the dcel-broad-phase digests
 * exercise (their 11 configs are all `none`/`classic`). The splice path
 * has been retuned before (#371); without this tripwire a retune moves
 * every traced puzzle's geometry — breaking every traced share link —
 * with no test going red.
 *
 * Cases go through `generateComposablePuzzle` with a numeric seed, the
 * exact path a share link replays, and mirror the production Wavy /
 * Triangles / sine-Classic configs in `cut-style-strategies.ts`.
 * `traceSetVersion` is pinned per case so a future
 * CURRENT_TRACE_SET_VERSION bump cannot move these digests.
 *
 * A red digest means something moved traced geometry: work out what and
 * decide whether to take it (breaking traced links) or version-gate it.
 * Do NOT re-record — `vitest -u` rewrites the snapshot without a word
 * and takes the alarm with it.
 */

// FNV-1a 32-bit digest of the concatenated piece shapes — a compact
// stand-in for the exact generated geometry bytes.
function digest(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

interface Case {
    label: string;
    cols: number;
    rows: number;
    width: number;
    height: number;
    seed: number;
    config: ComposableConfig;
}

const wavy = (
    cols: number, rows: number, width: number, height: number,
    traceSetVersion: number,
): ComposableConfig => ({
    baseCutGenerator: 'sine',
    baseCutConfig: { cols, rows, ha: 0.5, hf: cols / 2, va: 0.5, vf: rows / 2 },
    tabGenerator: 'traced',
    tabConfig: { traceSetVersion },
    minPieceArea: (width * height) / (cols * rows) / 4,
    borderless: false,
});

const classicSine = (
    cols: number, rows: number, width: number, height: number,
    traceSetVersion: number,
): ComposableConfig => ({
    baseCutGenerator: 'sine',
    baseCutConfig: { cols, rows, ha: 0.11, hf: cols / 3, va: 0.11, vf: rows / 3 },
    tabGenerator: 'traced',
    tabConfig: { traceSetVersion },
    minPieceArea: (width * height) / (cols * rows) / 4,
    borderless: false,
});

const triangles = (traceSetVersion: number): ComposableConfig => ({
    baseCutGenerator: 'triangular',
    baseCutConfig: { jitter: 0.5, smooth: true },
    tabGenerator: 'traced',
    tabConfig: { traceSetVersion },
});

const cases: Case[] = [
    { label: 'wavy 5x5 traced v1', cols: 5, rows: 5, width: 500, height: 500, seed: 101, config: wavy(5, 5, 500, 500, 1) },
    { label: 'wavy 6x5 traced v2', cols: 6, rows: 5, width: 600, height: 500, seed: 102, config: wavy(6, 5, 600, 500, 2) },
    { label: 'classic-sine 6x6 traced v1', cols: 6, rows: 6, width: 600, height: 600, seed: 103, config: classicSine(6, 6, 600, 600, 1) },
    { label: 'classic-sine 5x5 traced v2', cols: 5, rows: 5, width: 500, height: 500, seed: 104, config: classicSine(5, 5, 500, 500, 2) },
    // Triangular derives columns from aspect and opts into the deep
    // resolve ladder, the traced path's other rung-commitment regime.
    // Seed choice is load-bearing: V8's transcendentals (sin/cos/acos/
    // atan2/pow — measured on PR #575; hypot and sqrt are exact) differ
    // in the last ULP between macOS-arm64 and Linux-x64, and traced
    // splice decisions sit near thresholds such a difference can flip.
    // Seed 105 digested differently on the two platforms (one edge's
    // splice flipped); seed 106 was verified byte-identical on both. If
    // this case ever goes red on ONE platform only, with a diff confined
    // to the two pieces of a single edge, suspect that borderline before
    // suspecting a code change.
    { label: 'triangles r6 traced v2', cols: 8, rows: 6, width: 800, height: 600, seed: 106, config: triangles(2) },
];

describe('traced-tab geometry byte-identity (#574)', () => {
    beforeAll(async () => {
        await preloadTracedTabGenerator();
    });

    // Generous timeout: the triangles case runs the deep ladder over ~200
    // edges and exceeded vitest's 5s default on CI hardware.
    it.each(cases)('$label produces identical geometry', (c) => {
        const { pieces } = generateComposablePuzzle(
            c.cols, c.rows, { width: c.width, height: c.height },
            c.seed, c.config,
        );
        const shapes = pieces.map(p => p.shape).join('|');
        expect({ count: pieces.length, digest: digest(shapes) }).toMatchSnapshot();
    }, 60000);
});
