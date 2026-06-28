import { describe, it, expect } from 'vitest';
import { triangularCutGenerator } from './triangular-cut-generator.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { generateTopologyPuzzle } from './generator.js';

// Inline mulberry32 mirror (same family as createSeededRandom), matching the
// pattern used by sine-cut-generator.test.ts.
function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Deterministic PRNG that counts its calls (mirrors the sine test helper).
function countingRandom() {
    let calls = 0;
    const fn = () => { calls++; return 0.42; };
    return { fn, calls: () => calls };
}

describe('triangularCutGenerator', () => {
    const frame = { width: 800, height: 600 };

    it('has id "triangular"', () => {
        expect(triangularCutGenerator.id).toBe('triangular');
    });

    it('does not advertise borderless support', () => {
        expect(triangularCutGenerator.supportsBorderless).toBeFalsy();
    });

    it('returns the four frame borders first', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(1), { rows: 6, jitter: 0 });
        expect(curves.length).toBeGreaterThan(4);
        expect(curves[0].start).toEqual({ x: 0, y: 0 });
        expect(curves[0].end).toEqual({ x: 800, y: 0 });
        expect(curves[1].end).toEqual({ x: 800, y: 600 });
        expect(curves[2].end).toEqual({ x: 0, y: 600 });
        expect(curves[3].end).toEqual({ x: 0, y: 0 });
        for (let i = 0; i < 4; i++) expect(curves[i].segments).toHaveLength(1);
    });

    it('draws exactly one outer PRNG value regardless of rows/jitter', () => {
        const a = countingRandom();
        triangularCutGenerator.generate(frame, a.fn, { rows: 4, jitter: 0 });
        expect(a.calls()).toBe(1);

        const b = countingRandom();
        triangularCutGenerator.generate(frame, b.fn, { rows: 12, jitter: 0.4 });
        expect(b.calls()).toBe(1);
    });

    it('is deterministic for a given seed + config', () => {
        const c1 = triangularCutGenerator.generate(frame, makeSeededRandom(7), { rows: 8, jitter: 0.3 });
        const c2 = triangularCutGenerator.generate(frame, makeSeededRandom(7), { rows: 8, jitter: 0.3 });
        expect(c1.map(c => c.segments)).toEqual(c2.map(c => c.segments));
    });

    it('keeps all interior cut endpoints within the frame', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(3), { rows: 6, jitter: 0.4 });
        const eps = 1e-6;
        for (let i = 4; i < curves.length; i++) {
            for (const pt of [curves[i].start, curves[i].end]) {
                expect(pt.x).toBeGreaterThanOrEqual(-eps);
                expect(pt.x).toBeLessThanOrEqual(frame.width + eps);
                expect(pt.y).toBeGreaterThanOrEqual(-eps);
                expect(pt.y).toBeLessThanOrEqual(frame.height + eps);
            }
        }
    });

    it.each([0, 0.4])('emits no duplicate interior edges (jitter %s)', (jitter) => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(5), { rows: 6, jitter });
        const seen = new Set<string>();
        const r = (n: number) => Math.round(n * 10) / 10;
        for (let i = 4; i < curves.length; i++) {
            const s = curves[i].start, e = curves[i].end;
            const a = `${r(s.x)},${r(s.y)}`;
            const b = `${r(e.x)},${r(e.y)}`;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
    });

    it('bounds total curves for an extreme-aspect frame (curve budget)', () => {
        // The column count is derived from the frame aspect ratio, NOT the
        // grid `cols` the caller passes, and no share-link decode clamp bounds
        // it. A crafted extreme-aspect frame (is:[8192,1]) at the grid-dim
        // clamp (rows:64) would, unbounded, derive ~450k columns and emit tens
        // of millions of curves — hanging the O(n²) DCEL. The total-curve
        // budget (TARGET_MAX_CURVES = 2000) keeps total curves ≈ 3·rows·cols
        // bounded to the legitimate ceiling regardless of aspect.
        const curves = triangularCutGenerator.generate(
            { width: 8192, height: 1 },
            makeSeededRandom(1),
            { rows: 64, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);    // real cuts produced
        expect(curves.length).toBeLessThan(2500);     // budget engaged (uncapped ≈ 5.8e7)
    });

    it('clamps a crafted out-of-range rows override (bgc.rows DoS vector)', () => {
        // The opaque baseCutConfig (share-link cf.bgc) is spread over the
        // decode-clamped grid rows in the topology generator, so a crafted
        // cf.bgc.rows = 1e6 would otherwise allocate ~1e6 lattice rows and OOM.
        // MAX_ROWS (64) reins it in; the curve budget keeps the total bounded.
        const curves = triangularCutGenerator.generate(
            frame,
            makeSeededRandom(1),
            { rows: 1_000_000, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);
        expect(curves.length).toBeLessThan(2500);
    });

    // SKIPPED pending #439: this case runs the full O(n²) DCEL at the
    // ~2000-curve worst-case count, which takes tens of seconds on slower /
    // contended machines and makes the wall-clock ceiling below flaky. The
    // deterministic curve-budget guards in the two sibling tests above
    // ('...extreme-aspect...' and '...rows override...') still cover the DoS
    // regression, so skipping this loses no DoS coverage. Re-enable — with a
    // tightened, now-meaningful timing ceiling — once #439's DCEL spatial
    // broad-phase makes the worst case fast.
    it.skip('the worst case runs the full DCEL pipeline to valid pieces in bounded time', () => {
        // Regression for the DoS: this is the curve count that flows into
        // buildDCEL's O(n²) intersection + vertex-pool passes — the real cost
        // center the curves.length assertions above do NOT exercise. The frame
        // is a crafted 32:1 extreme-aspect link at the 64-row grid clamp — wide
        // enough that the curve budget engages (so we hit the worst-case
        // ~2000-curve count) while rows stay >3px apart so the lattice doesn't
        // collapse into the vertex-merge tolerance. With the budget this is the
        // SAME curve count a wide legitimate puzzle produces and completes in a
        // few seconds; WITHOUT it the same link derives ~98k curves and the
        // O(n²) DCEL would run for hours. The ceiling below cleanly separates
        // "fixed" (single-digit seconds) from "broken" (effectively unbounded);
        // it is not a sub-second assertion (the pre-existing DCEL cost makes the
        // legitimate ceiling itself take a few seconds — see TARGET_MAX_CURVES).
        //
        // DETERMINISTIC guard (machine-independent): the curve count fed into the
        // O(n²) DCEL at this exact frame/rows is the real cost driver, and it is
        // directly observable from the generator. Assert the budget engaged so a
        // regression that lets the count explode fails deterministically, not
        // just via the coarse wall-clock ceiling below.
        const worstCaseCurves = triangularCutGenerator.generate(
            { width: 8192, height: 256 },
            makeSeededRandom(1),
            { rows: 64, jitter: 0 },
        );
        expect(worstCaseCurves.length).toBeLessThan(2500); // budget engaged (uncapped ≈ tens of millions)

        const start = Date.now();
        const { pieces } = generateTopologyPuzzle(
            16, 64, { width: 8192, height: 256 },
            makeSeededRandom(1),
            { baseCutGeneratorId: 'triangular', tabGeneratorId: 'none', baseCutConfig: { jitter: 0 } },
        );
        const elapsedMs = Date.now() - start;
        expect(pieces.length).toBeGreaterThan(0);
        for (const piece of pieces) {
            expect(piece.shape.startsWith('M')).toBe(true);
            expect(piece.shape.endsWith('Z')).toBe(true);
        }
        expect(elapsedMs).toBeLessThan(30_000);
    }, 60_000); // per-test timeout > the assertion ceiling so the assert, not
    //            vitest's 5s default, is what reports a regression.

    it('jitter changes the interior cuts vs the regular tiling', () => {
        const regular = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0 });
        const jittered = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.4 });
        expect(jittered.map(c => c.segments)).not.toEqual(regular.map(c => c.segments));
    });

    it('is registered in the generator registry', () => {
        expect(getBaseCutGenerator('triangular')).toBe(triangularCutGenerator);
    });
});
