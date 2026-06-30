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
        // of millions of curves — freezing the DCEL. MAX_ROWS clamps rows to 16
        // and the total-curve budget (TARGET_MAX_CURVES = 7500) keeps total
        // curves ≈ 3·rows·cols bounded to the real max-size ceiling regardless
        // of aspect.
        const curves = triangularCutGenerator.generate(
            { width: 8192, height: 1 },
            makeSeededRandom(1),
            { rows: 64, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);    // real cuts produced
        expect(curves.length).toBeLessThan(8000);     // budget engaged (uncapped ≈ 5.8e7)
    });

    it('clamps a crafted out-of-range rows override (bgc.rows DoS vector)', () => {
        // The opaque baseCutConfig (share-link cf.bgc) is spread over the
        // decode-clamped grid rows in the topology generator, so a crafted
        // cf.bgc.rows = 1e6 would otherwise allocate ~1e6 lattice rows and OOM.
        // MAX_ROWS (16) reins it in; the curve budget keeps the total bounded.
        const curves = triangularCutGenerator.generate(
            frame,
            makeSeededRandom(1),
            { rows: 1_000_000, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);
        expect(curves.length).toBeLessThan(8000);
    });

    it('renders real ultrawide panoramas at full density at the max grid (#441)', () => {
        // Geometric lattice curve count for a rows=12 (192-piece) puzzle at a
        // given aspect; jitter off so the count is purely the column geometry.
        const curveCount = (aspect: number) => triangularCutGenerator.generate(
            { width: Math.round(aspect * 720), height: 720 },
            makeSeededRandom(1),
            { rows: 12, jitter: 0 },
        ).length;

        // Pre-#441 the budget (2000) clamped rows = 12 to 55 columns, plateauing
        // the lattice at ~5.34:1 (~1980 curves). The count now keeps climbing
        // with aspect well past that: a genuine 10:1 panorama is already above
        // the old plateau, and at 20:1 the lattice is still at full triangle
        // density. (20:1 lands exactly on the clamp boundary: geometric cols =
        // round(20·12·√3/2) = 208, equal to the rows = 12 colBudget of
        // floor(7500/36) = 208, so the clamp does not yet bite. The assertion
        // below is curveCount(20) > curveCount(16), which holds regardless of
        // which side of that boundary 20:1 rounds onto, so it isn't fragile.)
        expect(curveCount(10)).toBeGreaterThan(2500);
        expect(curveCount(20)).toBeGreaterThan(curveCount(16));
        // The clamp now engages only on clearly-absurd aspects (> ~20:1): beyond
        // the threshold the column count is pinned at the budget, so 25:1 and
        // 50:1 emit the same bounded count rather than growing without limit.
        expect(curveCount(50)).toBe(curveCount(25));
        expect(curveCount(50)).toBeLessThan(8000);
    });

    // Re-enabled by #439: the DCEL spatial broad-phase made raw curve count
    // cheap, so #441 raised the curve budget (2000 → 7500) to let real ≤20:1
    // panoramas render at full density and tightened MAX_ROWS (64 → 16) so the
    // crafted high-rows fineness case — the residual super-linear cost — still
    // builds in ~today's time. This wall-clock ceiling is a meaningful
    // regression guard: a change that defeats the broad-phase, the curve budget,
    // or the row clamp sends this back over the ceiling. The deterministic
    // curve-budget guards in the two sibling tests above ('...extreme-aspect...'
    // and '...rows override...') remain the machine-independent DoS guard; this
    // adds the end-to-end timing backstop.
    it('the worst case runs the full DCEL pipeline to valid pieces in bounded time', () => {
        // Regression for the DoS: this is the curve count that flows into
        // buildDCEL's broad-phased intersection + vertex-pool passes (#439's
        // spatial index) — the real cost center the curves.length assertions
        // above do NOT exercise. The frame is a crafted ~340:1 extreme-aspect
        // link requesting rows=64; MAX_ROWS clamps it to 16 and the curve budget
        // engages (so we hit the worst-case ~7500-curve count). The tight 24px
        // height (rowHeight = 24 / 16 = 1.5px) then packs those 16 rows into the
        // broad-phase's 6px proximity margin (BROAD_PHASE_MARGIN = 2× the 3px
        // vertex-merge tolerance), so most of the 16 rows co-occupy one
        // broad-phase cell-band and the per-cell candidate-pair count climbs
        // toward its 16²/2 cap. THIS — broad-phase candidate density, not vertex
        // collapse per se — is the dominant super-linear cost the TARGET_MAX_CURVES
        // rationale bounds. (At this 1.5px row pitch vertices DO also merge,
        // since 1.5 < the strictly-less-than 3px tolerance, so it is a genuine
        // collapsed frame — but the empirically-measured cost peak across heights
        // 8–64px sits here at the densest broad-phase band, ~5s on this machine,
        // not at the merge boundary.) So this run exercises the worst-case DCEL
        // work, not just a high curve count: a non-collapsed wide frame at the
        // same curve count finishes in well under a second, so it would NOT guard
        // this. The same crafted link WITHOUT the clamps derives ~3.6M curves
        // (rows = 64, ~18,900 cols), which even the broad-phase can't keep
        // interactive. The ceiling below cleanly separates "fixed" (a few
        // seconds) from "broken" (an unbounded blow-up).
        //
        // DETERMINISTIC guard (machine-independent): the curve count fed into the
        // DCEL at this exact frame/rows is the real cost driver, and it is
        // directly observable from the generator. Assert the budget engaged so a
        // regression that lets the count explode fails deterministically, not
        // just via the coarse wall-clock ceiling below.
        const worstCaseCurves = triangularCutGenerator.generate(
            { width: 8192, height: 24 },
            makeSeededRandom(1),
            { rows: 64, jitter: 0 },
        );
        expect(worstCaseCurves.length).toBeLessThan(8000); // budget engaged (uncapped ≈ 3.6M)

        const start = Date.now();
        const { pieces } = generateTopologyPuzzle(
            16, 64, { width: 8192, height: 24 },
            makeSeededRandom(1),
            { baseCutGeneratorId: 'triangular', tabGeneratorId: 'none', baseCutConfig: { jitter: 0 } },
        );
        const elapsedMs = Date.now() - start;
        expect(pieces.length).toBeGreaterThan(0);
        for (const piece of pieces) {
            expect(piece.shape.startsWith('M')).toBe(true);
            expect(piece.shape.endsWith('Z')).toBe(true);
        }
        // Locally the fixed code runs in a few seconds at this collapsed height
        // (~5s on this machine — the measured worst across heights 8–64px). This
        // wall-clock is only a COARSE backstop against an unbounded-blowup
        // regression (which would run tens of seconds to minutes); the
        // deterministic curve-budget assertion above is the precise,
        // machine-independent signal, so the ceiling is set deliberately loose to
        // avoid CI flakes. A 60s ceiling clears the ~5s local runtime by an order
        // of magnitude: the project's historical ~4.5× CI slowdown (~5s → ~23s),
        // even compounded with the un-probed ~1.5–2× horizontal-collapse variant,
        // still lands well under it, while a true pre-clamp blow-up still trips it.
        expect(elapsedMs).toBeLessThan(60_000);
    }, 75_000); // per-test timeout > the assertion ceiling so the assert, not
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
