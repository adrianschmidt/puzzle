import { describe, it, expect } from 'vitest';
import { triangularCutGenerator, catmullRomBezierEdge, estimateTriangleFaceCount } from './triangular-cut-generator.js';
import { Curve } from './curve.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { generateTopologyPuzzle } from './generator.js';
import { generateComposablePuzzle } from '../composable-generator.js';

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

describe('catmullRomBezierEdge', () => {
    const seg = (c: ReturnType<typeof catmullRomBezierEdge>) => c.segments[0];
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
        expect(p.x).toBeCloseTo(q.x, 9);
        expect(p.y).toBeCloseTo(q.y, 9);
    };

    it('reproduces a straight line for collinear, evenly-spaced neighbors', () => {
        const a = { x: 10, y: 0 }, b = { x: 20, y: 0 };
        const got = seg(catmullRomBezierEdge(a, b, { x: 0, y: 0 }, { x: 30, y: 0 }));
        const line = seg(Curve.line(a, b));
        near(got.cp1, line.cp1);
        near(got.cp2, line.cp2);
    });

    it('shares a tangent across a vertex (C1) between adjacent edges', () => {
        const z = { x: 0, y: 0 }, a = { x: 10, y: 5 }, b = { x: 20, y: -5 }, c = { x: 30, y: 0 }, d = { x: 40, y: 4 };
        const e1 = catmullRomBezierEdge(a, b, z, c);
        const e2 = catmullRomBezierEdge(b, c, a, d);
        near(e1.tangentAt(1), e2.tangentAt(0));
    });

    it('falls back to a straight edge when both neighbors are missing', () => {
        const a = { x: 3, y: 7 }, b = { x: 9, y: 2 };
        const got = seg(catmullRomBezierEdge(a, b, undefined, undefined));
        const line = seg(Curve.line(a, b));
        near(got.cp1, line.cp1);
        near(got.cp2, line.cp2);
    });
});

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

    // Cross product of (p0→cp) and (p0→p3); ~0 means the control point is on the chord.
    const chordCross = (s: { p0: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; p3: { x: number; y: number } }, cp: 'cp1' | 'cp2') => {
        const u = { x: s[cp].x - s.p0.x, y: s[cp].y - s.p0.y };
        const v = { x: s.p3.x - s.p0.x, y: s.p3.y - s.p0.y };
        return Math.abs(u.x * v.y - u.y * v.x);
    };
    const allStraight = (curves: ReturnType<typeof triangularCutGenerator.generate>) =>
        curves.slice(4).every(c => c.segments.length === 1
            && chordCross(c.segments[0], 'cp1') < 1e-6
            && chordCross(c.segments[0], 'cp2') < 1e-6);

    it('leaves interior edges straight when smooth is off', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3 });
        expect(allStraight(curves)).toBe(true);
    });

    it('stays straight with smooth on but jitter 0', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0, smooth: true });
        expect(allStraight(curves)).toBe(true);
    });

    it('bows at least one interior edge with smooth + jitter', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3, smooth: true });
        const bowed = curves.slice(4).some(c => chordCross(c.segments[0], 'cp1') > 1e-3 || chordCross(c.segments[0], 'cp2') > 1e-3);
        expect(bowed).toBe(true);
    });

    it('shares a tangent between adjacent smoothed edges at a jittered crossing', () => {
        // Two consecutive lattice-line edges are emitted sharing their crossing
        // vertex exactly (same internal node lookup), so curves[i].end ===
        // curves[i+1].start pinpoints a real interior crossing that both edges
        // bow around. At a genuinely jitter-kinked crossing the two edges must
        // leave a shared tangent (C1). This catches a wrong-but-collinear
        // beyond-neighbor index that the jitter-0 on-chord tests cannot: a wrong
        // neighbor is jittered to a different position, so it tilts the tangent
        // even though it still lies on the same lattice line.
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3, smooth: true });
        const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
            Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
        let checked = 0;
        for (let i = 4; i + 1 < curves.length; i++) {
            const c1 = curves[i], c2 = curves[i + 1];
            if (!same(c1.end, c2.start)) continue;
            // Only assert at a genuine interior crossing: both edges must
            // actually bow *at the shared vertex* (c1's cp2 and c2's cp1 off
            // their chords), which means each used a real beyond-neighbor rather
            // than the straight chain-end fallback. This both proves jitter
            // kinked the crossing and is exactly the case the on-chord jitter-0
            // tests can't reach.
            if (chordCross(c1.segments[0], 'cp2') < 1 || chordCross(c2.segments[0], 'cp1') < 1) continue;
            const t1 = c1.tangentAt(1), t2 = c2.tangentAt(0);
            expect(t1.x).toBeCloseTo(t2.x, 6);
            expect(t1.y).toBeCloseTo(t2.y, 6);
            checked++;
            if (checked >= 3) break;
        }
        // Guard the guard: fail if no real jittered crossing was exercised.
        expect(checked).toBeGreaterThan(0);
    });

    it('shares a tangent between adjacent smoothed DIAGONAL edges at a jittered crossing', () => {
        // The horizontal C1 test above relies on array order (consecutive
        // horizontal edges are collinear continuations). Diagonal continuation
        // edges are NOT adjacent in emission order, so that test never exercises
        // the diagonal beyond-neighbor indices (drStartK/drK/dlStartK/dlK). This
        // test reconstructs diagonal continuation pairs directly from geometry.
        //
        // Selection is independent of the indices under test: an edge's endpoints
        // (hence its chord) are fixed by the emission loop; the beyond-neighbor
        // indices only shape the Bézier tangents. So pairing edges by "shared
        // exact vertex + near-parallel chords + steeply diagonal orientation"
        // isolates a genuine down-right/down-left lattice line without smuggling
        // in the property being asserted. A wrong diagonal index leaves the chord
        // untouched but tilts a tangent, breaking C1 here.
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3, smooth: true });
        const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
            Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
        const unit = (a: { x: number; y: number }, b: { x: number; y: number }) => {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: dx / len, y: dy / len };
        };
        let checked = 0;
        for (let i = 4; i < curves.length; i++) {
            const c1 = curves[i];
            const d1 = unit(c1.start, c1.end);
            // Require c1 to be steeply diagonal (|dy|/|chord| ~0.87 for lattice
            // diagonals, ~0 for horizontals), excluding the horizontal case.
            if (Math.abs(d1.y) < 0.6) continue;
            for (let m = 4; m < curves.length; m++) {
                if (m === i) continue;
                const c2 = curves[m];
                if (!same(c1.end, c2.start)) continue;
                // Collinear continuation only: the down-right/down-left line
                // through the shared vertex, not a differently-oriented edge that
                // merely touches it (e.g. a DR-in / DL-out pair sits at dot ~0.5).
                const d2 = unit(c2.start, c2.end);
                if (d1.x * d2.x + d1.y * d2.y < 0.8) continue;
                // Both edges must bow at the shared vertex (real beyond-neighbors,
                // not the straight chain-end fallback) so the tangent is index-
                // sensitive.
                if (chordCross(c1.segments[0], 'cp2') < 1 || chordCross(c2.segments[0], 'cp1') < 1) continue;
                const t1 = c1.tangentAt(1), t2 = c2.tangentAt(0);
                expect(t1.x).toBeCloseTo(t2.x, 6);
                expect(t1.y).toBeCloseTo(t2.y, 6);
                checked++;
                break;
            }
            if (checked >= 3) break;
        }
        // Guard the guard: fail if no real jittered diagonal crossing was found.
        expect(checked).toBeGreaterThan(0);
    });

    it('draws exactly one outer PRNG value with smooth on', () => {
        const c = countingRandom();
        triangularCutGenerator.generate(frame, c.fn, { rows: 12, jitter: 0.4, smooth: true });
        expect(c.calls()).toBe(1);
    });

    it('emits the same interior edge count with smooth on vs off', () => {
        const off = triangularCutGenerator.generate(frame, makeSeededRandom(4), { rows: 8, jitter: 0.3 });
        const on = triangularCutGenerator.generate(frame, makeSeededRandom(4), { rows: 8, jitter: 0.3, smooth: true });
        expect(on.length).toBe(off.length);
    });

    it('keeps smoothed curves within the frame', () => {
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(2), { rows: 6, jitter: 0.4, smooth: true });
        const eps = 1e-6;
        for (let i = 4; i < curves.length; i++) {
            // Fine step so a transient bow-out between samples can't slip through.
            for (let t = 0; t <= 1; t += 0.02) {
                const p = curves[i].pointAt(t);
                expect(p.x).toBeGreaterThanOrEqual(-eps);
                expect(p.x).toBeLessThanOrEqual(frame.width + eps);
                expect(p.y).toBeGreaterThanOrEqual(-eps);
                expect(p.y).toBeLessThanOrEqual(frame.height + eps);
            }
        }
    });
});

describe('estimateTriangleFaceCount', () => {
    it('computes the strip formula for known cases', () => {
        // 400×400, rows 2: side = 2·200/√3 ≈ 230.9, cols = round(400/230.9) = 2
        expect(estimateTriangleFaceCount(2, { width: 400, height: 400 })).toBe(2 * (2 * 2 + 1));
        // 1080×720, rows 3: side ≈ 277.1, cols = round(1080/277.1) = 4
        expect(estimateTriangleFaceCount(3, { width: 1080, height: 720 })).toBe(3 * (2 * 4 + 1));
        // 720×1080, rows 4: side ≈ 311.8, cols = round(720/311.8) = 2
        expect(estimateTriangleFaceCount(4, { width: 720, height: 1080 })).toBe(4 * (2 * 2 + 1));
    });

    it('matches the exact face count of an unjittered, unsmoothed lattice', () => {
        const cases: Array<[number, { width: number; height: number }]> = [
            [2, { width: 400, height: 400 }],
            [3, { width: 1080, height: 720 }],
            [4, { width: 720, height: 1080 }],
        ];
        for (const [rows, frame] of cases) {
            const { pieces } = generateComposablePuzzle(1, rows, frame, 42, {
                baseCutGenerator: 'triangular',
                baseCutConfig: { jitter: 0, smooth: false },
                tabGenerator: 'none',
            });
            expect(pieces.length).toBe(estimateTriangleFaceCount(rows, frame));
        }
    });

    it('stays close under the production preset (jitter 0.5, smooth)', () => {
        const frame = { width: 1080, height: 720 };
        const estimate = estimateTriangleFaceCount(6, frame);
        const { pieces } = generateComposablePuzzle(1, 6, frame, 7, {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.5, smooth: true },
            tabGenerator: 'none',
        });
        // Jittered+bowed edges can add/drop the odd micro-face; ±15% is plenty
        // for a "~N" label while still catching a broken formula.
        expect(pieces.length).toBeGreaterThan(estimate * 0.85);
        expect(pieces.length).toBeLessThan(estimate * 1.15);
    });
});
