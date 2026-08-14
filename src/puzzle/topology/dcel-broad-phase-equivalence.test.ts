import { describe, it, expect } from 'vitest';
import { generateTopologyPuzzle } from './generator.js';
import type { TopologyGeneratorConfig } from './generator.js';

/**
 * Byte-identity guard for the DCEL spatial broad-phase (#439).
 *
 * The broad-phase is a pure performance change — it only skips
 * comparisons that provably can't produce a result — so the generated
 * face set (and every piece's SVG path) must stay byte-for-byte identical
 * to the pre-optimization output. That identity is the share-link / save
 * reproducibility contract.
 *
 * The digests below were captured from the original O(n²) implementation
 * and must not change. A changed digest means the broad-phase altered
 * geometry (dropped an intersection or merged a vertex differently),
 * breaking every share link for that generator. Do NOT re-record the
 * snapshot to make this pass — fix the broad-phase.
 *
 * bezier-js is also an input: `package.json` allows any 6.x, so the
 * `package-lock.json` version is part of the contract. A bump that moves
 * a piece path past the two decimals `p.shape` is formatted to shows up
 * here as a red digest (Dependabot auto-merge gates on it); pin or take
 * the bump deliberately, never re-record.
 *
 * This does not cover the `reduce()` coverage gap `complete-reduction.ts`
 * works around (#498) — these cases carry no gapped-and-crossing curve —
 * so that path is guarded by the 192-piece assertion in repro-bug.test.ts.
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

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

interface Case {
    label: string;
    cols: number;
    rows: number;
    width: number;
    height: number;
    seed: number;
    config: TopologyGeneratorConfig;
}

const sine = (
    ha: number, va: number, tabs: 'none' | 'classic',
): TopologyGeneratorConfig => ({
    baseCutGeneratorId: 'sine',
    baseCutConfig: { ha, hf: 1.5, va, vf: 1.5 },
    tabGeneratorId: tabs,
});

const venn = (
    w: number, h: number, tabs: 'none' | 'classic',
): TopologyGeneratorConfig => ({
    baseCutGeneratorId: 'venn',
    baseCutConfig: {
        leftCenter: { x: w * 0.4, y: h * 0.5 }, leftRadius: Math.min(w, h) * 0.3,
        rightCenter: { x: w * 0.6, y: h * 0.5 }, rightRadius: Math.min(w, h) * 0.3,
    },
    tabGeneratorId: tabs,
});

const triangular = (
    rows: number, jitter: number, tabs: 'none' | 'classic',
): TopologyGeneratorConfig => ({
    baseCutGeneratorId: 'triangular',
    baseCutConfig: { rows, jitter },
    tabGeneratorId: tabs,
});

const cases: Case[] = [
    // Flat sine grid (straight cuts): pure lattice — most curve pairs non-adjacent, skipped.
    { label: 'sine-flat 3x3 none', cols: 3, rows: 3, width: 300, height: 300, seed: 1, config: sine(0, 0, 'none') },
    { label: 'sine-flat 6x6 none', cols: 6, rows: 6, width: 600, height: 600, seed: 2, config: sine(0, 0, 'none') },
    { label: 'sine-flat 8x6 classic', cols: 8, rows: 6, width: 800, height: 600, seed: 3, config: sine(0, 0, 'classic') },
    // Wavy sine (curved cuts): bézier-bézier crossings — checks curve-curve solves unperturbed.
    { label: 'wavy 4x4 none', cols: 4, rows: 4, width: 400, height: 400, seed: 4, config: sine(0.15, 0.15, 'none') },
    { label: 'wavy 6x5 none', cols: 6, rows: 5, width: 600, height: 500, seed: 5, config: sine(0.18, 0.12, 'none') },
    { label: 'wavy 5x5 classic', cols: 5, rows: 5, width: 500, height: 500, seed: 6, config: sine(0.15, 0.15, 'classic') },
    // Venn: circles + border — T-junctions exercise the endpoint-on-curve margin.
    { label: 'venn none', cols: 4, rows: 4, width: 480, height: 360, seed: 7, config: venn(480, 360, 'none') },
    { label: 'venn classic', cols: 4, rows: 4, width: 480, height: 360, seed: 8, config: venn(480, 360, 'classic') },
    // Triangular lattice: one curve per edge — highest curve count, the worst case.
    { label: 'triangular r6 j0 none', cols: 8, rows: 6, width: 800, height: 600, seed: 9, config: triangular(6, 0, 'none') },
    { label: 'triangular r8 j0.3 none', cols: 10, rows: 8, width: 900, height: 600, seed: 10, config: triangular(8, 0.3, 'none') },
    { label: 'triangular r6 j0.2 classic', cols: 8, rows: 6, width: 800, height: 600, seed: 11, config: triangular(6, 0.2, 'classic') },
];

describe('DCEL broad-phase byte-identity (#439)', () => {
    it.each(cases)('$label produces identical geometry', (c) => {
        const { pieces } = generateTopologyPuzzle(
            c.cols, c.rows, { width: c.width, height: c.height },
            seededRandom(c.seed), c.config,
        );
        const shapes = pieces.map(p => p.shape).join('|');
        expect({ count: pieces.length, digest: digest(shapes) }).toMatchSnapshot();
    });
});
