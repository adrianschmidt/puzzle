import { describe, it, expect } from 'vitest';
import {
    triangularCutGenerator,
    catmullRomBezierEdge,
    estimateTriangleFaceCount,
    deriveTriangleColumns,
} from './triangular-cut-generator.js';
import { Curve } from './curve.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { generateTopologyPuzzle } from './generator.js';
import { generateComposablePuzzle } from '../composable-generator.js';

// Inline mulberry32 mirror (like sine-cut-generator.test.ts).
function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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
        // Column count is derived from the frame aspect ratio, NOT the grid `cols`,
        // and no decode clamp bounds it. A crafted is:[8192,1] at rows:64 would,
        // unbounded, derive ~450k columns and tens of millions of curves. MAX_ROWS
        // clamps rows to 16 and the curve budget (TARGET_MAX_CURVES=7500) bounds
        // total curves ≈ 3·rows·cols regardless of aspect.
        const curves = triangularCutGenerator.generate(
            { width: 8192, height: 1 },
            makeSeededRandom(1),
            { rows: 64, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);    // real cuts produced
        expect(curves.length).toBeLessThan(8000);     // budget engaged (uncapped ≈ 5.8e7)
    });

    it('clamps a crafted out-of-range rows override (bgc.rows DoS vector)', () => {
        // The opaque baseCutConfig (cf.bgc) is spread over the decode-clamped grid
        // rows in the topology generator, so a crafted cf.bgc.rows = 1e6 would
        // allocate ~1e6 rows and OOM. MAX_ROWS (16) reins it in; the budget bounds
        // the total.
        const curves = triangularCutGenerator.generate(
            frame,
            makeSeededRandom(1),
            { rows: 1_000_000, jitter: 0 },
        );
        expect(curves.length).toBeGreaterThan(4);
        expect(curves.length).toBeLessThan(8000);
    });

    it('renders real ultrawide panoramas at full density at the max grid (#441)', () => {
        // Lattice curve count for rows=12 at a given aspect; jitter off so it's
        // pure column geometry.
        const curveCount = (aspect: number) => triangularCutGenerator.generate(
            { width: Math.round(aspect * 720), height: 720 },
            makeSeededRandom(1),
            { rows: 12, jitter: 0 },
        ).length;

        // The count keeps climbing with aspect: a genuine 10:1 panorama is already
        // above the old plateau, and 20:1 is still at full triangle density (it
        // lands on the clamp boundary — cols = round(20·12·√3/2) = 208 = the
        // rows=12 budget floor(7500/36) — so the clamp doesn't yet bite). The
        // assertion curveCount(20) > curveCount(16) holds either side of that
        // boundary, so it isn't fragile.
        expect(curveCount(10)).toBeGreaterThan(2500);
        expect(curveCount(20)).toBeGreaterThan(curveCount(16));
        // Beyond ~20:1 the column count is pinned at the budget, so 25:1 and 50:1
        // emit the same bounded count rather than growing without limit.
        expect(curveCount(50)).toBe(curveCount(25));
        expect(curveCount(50)).toBeLessThan(8000);
    });

    // Wall-clock regression guard: a change that defeats the broad-phase, the
    // curve budget, or the row clamp sends this back over the ceiling. The
    // deterministic curve-budget guards in the two sibling tests above stay the
    // machine-independent DoS guard; this adds the end-to-end timing backstop.
    it('the worst case runs the full DCEL pipeline to valid pieces in bounded time', () => {
        // Regression for the DoS: this curve count flows into buildDCEL's
        // broad-phased intersection + vertex-pool passes (#439) — the real cost
        // center the curves.length assertions above do NOT exercise. The crafted
        // ~340:1 frame requests rows=64; MAX_ROWS clamps to 16 and the budget
        // engages (~7500 curves). The 1.5px row pitch packs 16 rows into the
        // broad-phase's 6px proximity margin, so per-cell candidate density (not
        // vertex collapse) is the dominant super-linear cost TARGET_MAX_CURVES
        // bounds; a non-collapsed wide frame at the same curve count finishes in
        // well under a second. Unclamped this derives ~3.6M curves.
        //
        // DETERMINISTIC guard (machine-independent): the curve count at this exact
        // frame/rows is the real cost driver and is directly observable, so assert
        // the budget engaged — a regression that lets the count explode fails
        // deterministically, not just via the wall-clock ceiling below.
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
        // ~5s locally (measured worst across heights 8–64px). This wall-clock is a
        // COARSE backstop against an unbounded-blowup regression; the deterministic
        // budget assertion above is the precise signal, so the 60s ceiling is set
        // loose to avoid CI flakes (clears ~5s local and the ~4.5× CI slowdown by an
        // order of magnitude, while a true pre-clamp blow-up still trips it).
        expect(elapsedMs).toBeLessThan(60_000);
    }, 75_000); // > the 60s assertion ceiling so the assert, not vitest's default, reports a regression.

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
        // Consecutive lattice-line edges share their crossing vertex exactly, so
        // curves[i].end === curves[i+1].start pinpoints a real interior crossing
        // both edges bow around; at a jitter-kinked crossing they must share a
        // tangent (C1). Catches a wrong-but-collinear beyond-neighbor index the
        // jitter-0 on-chord tests can't: a wrong neighbor is jittered elsewhere, so
        // it tilts the tangent while still on the same lattice line.
        const curves = triangularCutGenerator.generate(frame, makeSeededRandom(9), { rows: 6, jitter: 0.3, smooth: true });
        const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
            Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
        let checked = 0;
        for (let i = 4; i + 1 < curves.length; i++) {
            const c1 = curves[i], c2 = curves[i + 1];
            if (!same(c1.end, c2.start)) continue;
            // Only assert at a genuine interior crossing: both edges must bow at
            // the shared vertex (c1.cp2, c2.cp1 off their chords), i.e. each used a
            // real beyond-neighbor, not the straight chain-end fallback.
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
        // The horizontal C1 test relies on array order (consecutive horizontals are
        // collinear); diagonal continuations are NOT adjacent in emission order, so
        // it never exercises the diagonal beyond-neighbor indices
        // (drStartK/drK/dlStartK/dlK). This reconstructs diagonal pairs from
        // geometry. Selection is independent of those indices — endpoints (hence the
        // chord) are fixed by the emission loop, the indices only shape the tangents
        // — so pairing by shared vertex + near-parallel chords + steep orientation
        // isolates a real diagonal line without smuggling in the asserted property.
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
            // Require c1 steeply diagonal (|dy| ~0.87 for diagonals, ~0 for horizontals).
            if (Math.abs(d1.y) < 0.6) continue;
            for (let m = 4; m < curves.length; m++) {
                if (m === i) continue;
                const c2 = curves[m];
                if (!same(c1.end, c2.start)) continue;
                // Collinear continuation only (dot ≥ 0.8): the DR/DL line through the
                // shared vertex, not a merely-touching edge (a DR-in/DL-out pair sits
                // at dot ~0.5).
                const d2 = unit(c2.start, c2.end);
                if (d1.x * d2.x + d1.y * d2.y < 0.8) continue;
                // Both edges must bow at the shared vertex (real beyond-neighbors) so
                // the tangent is index-sensitive.
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

describe('border jitter clamp', () => {
    // Production Triangles preset. The border-adjacent odd-row node at x=colStep/2
    // barely clears the jitter-eligibility inset at jitter 0.5, so before the
    // half-way clamp an unlucky draw could carry it near the 3px border merge
    // margin — squashing a degree-6 crossing (sliver pieces) and dragging bowed
    // control points outside the frame. Seed 1194584204 at 1080×608 is the
    // reported case.
    const preset = { jitter: 0.5, smooth: true };
    const cases = [
        { frame: { width: 1080, height: 608 }, rows: 3 },
        { frame: { width: 1080, height: 720 }, rows: 4 },
        { frame: { width: 1920, height: 640 }, rows: 6 },
    ];

    // Danger-band threshold from the real column derivation, so it can't drift
    // from the lattice.
    const colStepOf = (rows: number, frame: { width: number; height: number }) =>
        frame.width / deriveTriangleColumns(rows, frame);

    it('never leaves a lattice vertex in the left/right border danger band', () => {
        let checked = 0;
        for (const { frame, rows } of cases) {
            const colStep = colStepOf(rows, frame);
            for (let seed = 0; seed < 200; seed++) {
                const curves = triangularCutGenerator.generate(
                    frame, makeSeededRandom(seed), { rows, ...preset },
                );
                for (let i = 4; i < curves.length; i++) {
                    for (const p of [curves[i].pointAt(0), curves[i].pointAt(1)]) {
                        checked++;
                        for (const d of [p.x, frame.width - p.x]) {
                            // On/near-border endpoints (clip/border nodes) are fine;
                            // a vertex strictly inside the band (3px, colStep/4) is a
                            // squashed crossing.
                            const inBand = d > 3.001 && d < colStep / 4 - 1e-6;
                            if (inBand) {
                                expect.fail(
                                    `seed ${seed} ${frame.width}x${frame.height} rows ${rows}: ` +
                                    `endpoint (${p.x.toFixed(2)},${p.y.toFixed(2)}) is ${d.toFixed(2)}px ` +
                                    `from a vertical border (band 3..${(colStep / 4).toFixed(1)})`,
                                );
                            }
                        }
                    }
                }
            }
        }
        // Guard the guard: fail if the sweep never saw an interior curve.
        expect(checked).toBeGreaterThan(0);
    });

    it('keeps production-preset curves within the frame across seeds', () => {
        const eps = 1e-6;
        let checked = 0;
        for (const { frame, rows } of cases) {
            for (let seed = 0; seed < 200; seed++) {
                const curves = triangularCutGenerator.generate(
                    frame, makeSeededRandom(seed), { rows, ...preset },
                );
                for (let i = 4; i < curves.length; i++) {
                    // Integer stepping so t=1 is sampled exactly (a += 0.02
                    // overshoots 1 and skips the endpoint).
                    for (let s = 0; s <= 50; s++) {
                        const p = curves[i].pointAt(s / 50);
                        checked++;
                        if (p.x < -eps || p.x > frame.width + eps
                            || p.y < -eps || p.y > frame.height + eps) {
                            expect.fail(
                                `seed ${seed} ${frame.width}x${frame.height} rows ${rows}: ` +
                                `curve point (${p.x.toFixed(2)},${p.y.toFixed(2)}) outside frame`,
                            );
                        }
                    }
                }
            }
        }
        // Guard the guard: fail if the sweep never sampled an interior curve.
        expect(checked).toBeGreaterThan(0);
    });

    it('regression: seed 1194584204 at 1080×608 has no sliver or bulging piece', () => {
        // Reported bug: a crossing jittered to ~10.8px from the left border made
        // 0–200px² slivers and cuts bowing ~8px outside the frame. Tabs land after
        // the base cut, so tabGenerator 'none' reproduces the exact lattice cheaply.
        const frame = { width: 1080, height: 608 };
        const { pieces } = generateComposablePuzzle(6, 3, frame, 1194584204, {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.5, smooth: true },
            tabGenerator: 'none',
        });
        const avgArea = (frame.width * frame.height) / pieces.length;
        for (const [idx, piece] of pieces.entries()) {
            const pts = piece.edges.flatMap(
                (e) => (e.curvePoints?.length ? e.curvePoints : [e.start, e.end]),
            ).map((p) => ({ x: p.x - piece.imageOffset.x, y: p.y - piece.imageOffset.y }));
            for (const p of pts) {
                const at = `piece ${idx} point (${p.x.toFixed(2)},${p.y.toFixed(2)})`;
                expect(p.x, at).toBeGreaterThanOrEqual(-1);
                expect(p.x, at).toBeLessThanOrEqual(frame.width + 1);
                expect(p.y, at).toBeGreaterThanOrEqual(-1);
                expect(p.y, at).toBeLessThanOrEqual(frame.height + 1);
            }
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const q = pts[(i + 1) % pts.length];
                area += p.x * q.y - q.x * p.y;
            }
            expect(Math.abs(area) / 2, `piece ${idx} area`).toBeGreaterThan(avgArea * 0.03);
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
