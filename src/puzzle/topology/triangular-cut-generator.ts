/**
 * Equilateral / isometric triangle base-cut generator.
 *
 * Tiles the frame with near-equilateral triangles (three line families:
 * horizontal plus ±60°), emitted as a deduplicated set of per-edge line
 * segments between shared lattice vertices — NOT maximal full-frame lines.
 * The DCEL builder merges coincident endpoints (3px tolerance) and handles
 * the degree-6 vertices a triangular lattice produces, so a vertex-meeting
 * lattice composes correctly.
 *
 * The horizontal column spacing is snapped so a whole number of columns
 * divides the frame width exactly. This aligns the lattice to the left/right
 * borders, so border triangles are clean half-triangles rather than the thin
 * slivers an unaligned `width / side` remainder would leave — at the cost of
 * triangles that are very slightly isoceles rather than perfectly equilateral.
 *
 * Border curves come first (top, right, bottom, left). The frame's left/right
 * edges cut border triangles into partial pieces, by design.
 */

import type { Size, Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';
import { createSeededRandom } from '../seeded-random.js';

export interface TriangularCutConfig {
    /** Triangle rows; row height = frame.height / rows. Injected from the
     *  size grid by the topology generator. */
    rows: number;
    /** Irregularity amplitude, fraction of side length (0–0.5). */
    jitter: number;
    /** When true, bow each interior cut edge so adjacent edges on the same
     *  lattice line share a tangent (smooth "flowing" cuts). No-op at
     *  jitter 0. Consumes no randomness. */
    smooth: boolean;
}

/** Map a [0,1) float onto a 32-bit integer seed (CLAUDE.md sub-PRNG helper). */
function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

/**
 * Worst-case budget on the TOTAL number of lattice curves this generator may
 * emit. The lattice emits ~`3 · rows · cols` single-segment curves (one
 * horizontal + two diagonal families), and that whole set is fed to
 * `buildDCEL`. Since #439 the DCEL's intersection pass (`findAllIntersections`)
 * and vertex pool (`VertexPool.getOrCreate`) are fronted by a spatial
 * broad-phase, so for lattice-scale geometry their candidate work is ~O(n)
 * rather than the old O(n²). That made raw curve count cheap — a real
 * rows = 12 panorama builds ~7k curves in a few hundred ms — and is what lets
 * this budget sit far higher than its pre-#439 value of 2000 (see #441).
 *
 * The residual super-linear cost is not curve count but lattice *fineness*: a
 * crafted link with many rows packed into a tiny frame height collapses the
 * vertical spacing toward the DCEL's 3px vertex-merge tolerance, multiplying
 * the per-curve merge/T-junction work. Empirically that cost climbs steeply
 * with the row count (a 16×12-equivalent wide puzzle is sub-second, but the
 * same curve budget at rows ≈ 64 runs several seconds). The two crafted
 * dimensions that drive it are NOT bounded by the share-link decode clamps on
 * their own:
 *   - `cols` is NOT the grid `cols` the caller passes; it is derived from the
 *     frame aspect ratio (`cols ≈ (w/h)·rows·√3/2`), and no decode clamp bounds
 *     the aspect ratio. A crafted extreme-aspect link (`is:[8192,1]`) derives
 *     hundreds of thousands of columns.
 *   - `rows` is normally the grid rows (decode-clamped to 64), but the opaque
 *     `baseCutConfig` (share-link `cf.bgc`) is spread over it in the topology
 *     generator AFTER the clamp, so a crafted `cf.bgc.rows = 1e6` flows in
 *     unbounded.
 * This budget squeezes `cols` so total curves stay ≤ ~TARGET_MAX_CURVES for any
 * `rows` (curves ≈ 3·rows·cols, and cols ≤ TARGET_MAX_CURVES/(3·rows)), while
 * {@link MAX_ROWS} independently caps the row count — together they bound the
 * fineness term, so the crafted worst case stays in the ~4–5.25s range (measured)
 * regardless of how the two dimensions are pushed.
 *
 * Value chosen so the clamp is a no-op across the entire real landscape range,
 * engaging only on clearly-absurd aspects. The largest real puzzle is the
 * 16×12 grid (rows = 12); at rows = 12 the per-row column budget is
 * floor(7500 / 36) = 208, and the derived column count is cols ≈ (w/h)·rows·√3/2,
 * so the budget first engages at an aspect of ~20:1. Every real landscape photo
 * — including genuine ultrawide panoramas up to 20:1 at the 192-piece size —
 * now renders at full triangle density, so the budget does not perturb their
 * geometry or jitter draw order.
 *
 * It is NOT a strict no-op for every conceivable puzzle: a panorama wider than
 * ~20:1 at rows = 12 derives more than 208 columns and IS clamped, compressing
 * its horizontal lattice slightly. That clamp is deterministic — it runs
 * identically on sender and receiver from the same inputs — so it is a bounded,
 * deliberate geometry trade-off, not a reproducibility break. Raising the value
 * from 2000 (the #441 change) re-derived geometry for any previously-clamped
 * 5.34:1–20:1 puzzle; that was acceptable only because triangular was
 * unreleased at the time. As of the Triangles release, this value is frozen as
 * part of the share-link contract (like {@link MAX_ROWS}): it feeds both
 * `generate`'s column budget and {@link estimateTriangleFaceCount} →
 * `selectTriangleRows`, so changing it would re-derive the selected row count
 * and lattice geometry for existing links wherever the clamp binds.
 *
 * It is deliberately NOT higher: pushing the budget past the real-landscape
 * ceiling would only raise the crafted worst case's curve count and build time
 * with no fidelity benefit (no real puzzle exceeds ~20:1 at max size). The win
 * here is eliminating the DoS *amplification*: a crafted `is:[8192,1]`,
 * `g:[*,64]` link drops from tens of millions of curves (~450k columns — a
 * multi-minute, effectively unbounded freeze) to the bounded ~7500-curve
 * ceiling at the {@link MAX_ROWS}-capped row count (~4–5.25s), so a share link can
 * no longer cost more than the worst real max-size panorama. Capping here
 * (rather than at decode) also protects the dev console and any future entry
 * point.
 */
const TARGET_MAX_CURVES = 7500;

/**
 * Hard upper bound on the triangle-row count. It serves two ends: bounding the
 * O(rows · cols) node-allocation loop against a crafted `cf.bgc.rows` override,
 * and — since #441 raised {@link TARGET_MAX_CURVES} — capping the lattice
 * fineness that is now the DCEL's dominant super-linear cost (many rows in a
 * tight frame collapse toward the 3px vertex-merge tolerance; see the
 * TARGET_MAX_CURVES rationale).
 *
 * Set to 16: the largest real puzzle is the 16×12 grid (rows = 12), but
 * `selectTriangleRows` legitimately reaches this cap for extreme-portrait
 * images at the 192-piece target, so the clamp engages for real puzzles, not
 * just crafted ones. It is deliberately BELOW the share-link `MAX_GRID_DIM`
 * (64): with the higher curve budget, an unclamped crafted rows ≈ 64 link in
 * a tight frame would run several seconds, so anything the decoder or a
 * `bgc.rows` override pushes into the 17–64 range is reined back to 16,
 * keeping the crafted worst-case build at ~today's ~4–5.25s level (measured).
 * The clamp engaging within the decoder's range is intentional and only
 * affects crafted links (no real puzzle exceeds 12 rows); like the curve
 * budget it is deterministic, so it does not break reproducibility. As of the
 * Triangles release, this value is frozen as part of the share-link contract:
 * `selectTriangleRows` re-derives its row count from this cap on every
 * decode, so raising MAX_ROWS later would change the selected row count —
 * and therefore the reproduced puzzle — for any existing link that was
 * capped at 16.
 */
export const MAX_ROWS = 16;

/**
 * Derive the lattice column count for a (clamped) row count and frame — the
 * single column derivation shared by `generate` and
 * {@link estimateTriangleFaceCount}, so the estimator cannot drift from the
 * generator's real lattice.
 *
 * The equilateral side implied by the row height is used only to choose how
 * many whole columns best fit the width; the caller snaps the horizontal
 * spacing so that many columns divide the width exactly (triangles become
 * very slightly isosceles). The total-curve budget caps clearly-absurd
 * extreme-aspect cases (see {@link TARGET_MAX_CURVES}): the lattice emits
 * ~3·rows·cols curves, so the per-row column budget keeps the total bounded
 * for the DCEL. Every real landscape — up to ~20:1 panoramas at the
 * 192-piece size — derives no more columns than the budget and is unaffected.
 *
 * Part of the released Triangles share-link contract: both the generator's
 * geometry and the row selection re-derive from this on every decode.
 */
function deriveTriangleColumns(rows: number, frame: Size): number {
    const rowHeight = frame.height / rows;
    const equilateralSide = (2 * rowHeight) / Math.sqrt(3);
    const colBudget = Math.max(1, Math.floor(TARGET_MAX_CURVES / (3 * rows)));
    return Math.min(colBudget, Math.max(1, Math.round(frame.width / equilateralSide)));
}

/**
 * Estimate the face (piece) count the lattice produces for a given row count
 * and frame — the sizing input for the Triangles cut style's aspect-adaptive
 * row selection. Shares {@link deriveTriangleColumns} with `generate`, so the
 * estimate tracks the generator's real column math by construction.
 *
 * Exact for `jitter: 0, smooth: false` (each strip holds 2·cols full
 * triangles plus two border half-triangles); the production preset's jitter
 * and bowing can add or drop the odd micro-face, which the ~N size labels
 * absorb.
 *
 * Part of the released Triangles share-link contract: `selectTriangleRows`
 * re-derives the row count from this estimate on every decode, so changing
 * the formula changes which puzzle an existing link reproduces.
 */
export function estimateTriangleFaceCount(rows: number, frame: Size): number {
    const r = Math.min(MAX_ROWS, Math.max(1, Math.floor(rows)));
    const cols = deriveTriangleColumns(r, frame);
    return r * (2 * cols + 1);
}

/**
 * Border / jitter inset margin, in pixels, added on top of the jitter reach.
 * Must stay at least the DCEL's `VERTEX_MERGE_TOLERANCE` (3px, module-private
 * in dcel.ts) so a jittered node or a clipped border-triangle endpoint can
 * never land within merge distance of the frame edge — which would fuse a
 * lattice vertex onto the border curve and corrupt the face set. Kept in sync
 * with that tolerance by hand; if dcel.ts ever raises it, raise this too.
 */
const BORDER_MERGE_MARGIN_PX = 3;

/**
 * Liang–Barsky clip of segment a→b to the rectangle [0,w]×[0,h]. Returns the
 * clipped endpoints, or null when the segment lies fully outside.
 */
function clipSegmentToFrame(a: Point, b: Point, w: number, h: number): [Point, Point] | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x, w - a.x, a.y, h - a.y];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null; // parallel to this edge and outside it
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > t1) return null;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return null;
                if (t < t1) t1 = t;
            }
        }
    }
    return [
        { x: a.x + t0 * dx, y: a.y + t0 * dy },
        { x: a.x + t1 * dx, y: a.y + t1 * dy },
    ];
}

/**
 * Build one cubic Bézier for the cut edge a→b, bowed so its endpoint tangents
 * are shared with the adjacent edges on the same lattice line (uniform
 * Catmull-Rom → Bézier). `beyondA` is the crossing before `a` on that line and
 * `beyondB` the crossing after `b`; either may be undefined at a chain end, in
 * which case that end uses the straight control point (identical to
 * `Curve.line`). Parameter-free: when the four points are collinear and evenly
 * spaced (the lattice at jitter 0) it reproduces an exact straight line.
 */
export function catmullRomBezierEdge(
    a: Point,
    b: Point,
    beyondA: Point | undefined,
    beyondB: Point | undefined,
): Curve {
    const cp1 = beyondA
        ? { x: a.x + (b.x - beyondA.x) / 6, y: a.y + (b.y - beyondA.y) / 6 }
        : { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    const cp2 = beyondB
        ? { x: b.x - (beyondB.x - a.x) / 6, y: b.y - (beyondB.y - a.y) / 6 }
        : { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 };
    return new Curve([{ p0: a, cp1, cp2, p3: b }]);
}

export const triangularCutGenerator: BaseCutGenerator = {
    id: 'triangular',
    // supportsBorderless intentionally omitted (falsy): a jittered, partial-edge
    // tiling has no clean 1-deep rectangular ring for strip-border-ring.ts.

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<TriangularCutConfig>;
        // MAX_ROWS bounds the node-allocation loop AND the lattice fineness
        // (the DCEL's dominant cost) against a crafted `cf.bgc.rows` override or
        // an over-range grid; it sits just above the largest real puzzle's 12
        // rows, so it is a no-op for every legitimate (and dev-console) row
        // count and only reins in crafted links.
        const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(cfg.rows ?? 1)));
        const jitter = Math.min(0.5, Math.max(0, cfg.jitter ?? 0.15));
        const smooth = cfg.smooth === true;
        const w = frame.width;
        const h = frame.height;

        // ONE outer draw seeds the local sub-PRNG; every jitter draw uses
        // `local`, so the outer stream advances by exactly one call regardless
        // of rows/jitter (reproducibility contract).
        const local = createSeededRandom(seedFromFloat(random()));

        const rowHeight = h / rows;
        // Snap the horizontal spacing so a whole number of columns divides the
        // width exactly, aligning the lattice to the left/right borders (no
        // sliver column); see deriveTriangleColumns for the equilateral snap
        // and the curve-budget clamp.
        const cols = deriveTriangleColumns(rows, frame);
        const colStep = w / cols;
        // Representative cell size for jitter magnitude / border inset — use the
        // smaller axis so a jittered vertex can't reach a neighbour or border.
        const cell = Math.min(colStep, rowHeight);

        // One column past each side so the border half-triangles' diagonals
        // exist and clip onto the frame; even-row k=0 and k=cols land exactly
        // on the left/right borders.
        const kMin = -1;
        const kMax = cols + 1;

        // Pre-compute every node position in a FIXED (j,k) order so the jitter
        // draw order is deterministic; edge emission only reads these.
        const nodes = new Map<string, Point>();
        // Only jitter nodes comfortably inside the frame, so jittered nodes and
        // clip points stay clear of the border and the 3px merge tolerance.
        const inset = cell * jitter + BORDER_MERGE_MARGIN_PX;
        const key = (j: number, k: number) => `${j}:${k}`;
        for (let j = 0; j <= rows; j++) {
            const rowShift = (j % 2 === 0) ? 0 : colStep / 2;
            const y = j * rowHeight;
            for (let k = kMin; k <= kMax; k++) {
                const x = k * colStep + rowShift;
                let px = x;
                let py = y;
                const insideInset = x > inset && x < w - inset && y > inset && y < h - inset;
                if (jitter > 0 && insideInset) {
                    const ang = local() * Math.PI * 2;
                    const mag = local() * jitter * cell;
                    px = x + Math.cos(ang) * mag;
                    py = y + Math.sin(ang) * mag;
                }
                nodes.set(key(j, k), { x: px, y: py });
            }
        }
        const pos = (j: number, k: number): Point => nodes.get(key(j, k))!;

        // Neighbor lattice direction helpers (col index in the adjacent row).
        // These mirror the diagonal emission below; `maybePos` returns
        // undefined off-lattice so the smoothed edge stays straight at a chain
        // end. It also short-circuits to undefined when `smooth` is off, so the
        // straight (smooth-off) path builds no `key` strings and does no
        // Map.gets for beyond-neighbors — the eager call-site args cost only the
        // trivial index arithmetic (`drStartK` etc.) plus a returned-undefined
        // function call when smoothing is disabled.
        const maybePos = (j: number, k: number): Point | undefined =>
            smooth ? nodes.get(key(j, k)) : undefined;
        const even = (j: number) => j % 2 === 0;
        const drK = (j: number, k: number) => even(j) ? k : k + 1;   // down-right col, row j+1
        const dlK = (j: number, k: number) => even(j) ? k - 1 : k;   // down-left col, row j+1
        // Beyond-start neighbor (row j-1) continuing each diagonal line upward,
        // i.e. the node whose down-right / down-left neighbor is (j,k).
        const drStartK = (j: number, k: number) => even(j) ? k - 1 : k;   // prev node on the down-right line
        const dlStartK = (j: number, k: number) => even(j) ? k : k + 1;   // prev node on the down-left line

        // Borders FIRST (top, right, bottom, left), per the contract.
        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
            Curve.line({ x: w, y: 0 }, { x: w, y: h }),
            Curve.line({ x: w, y: h }, { x: 0, y: h }),
            Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
        ];

        const inFrame = (p: Point) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
        const pushEdge = (
            a: Point,
            b: Point,
            beyondA?: Point,
            beyondB?: Point,
        ): void => {
            // Smooth path: both endpoints inside the frame → bow the edge.
            // (Fringe edges with an endpoint outside the frame fall through to
            // the straight clip below, as before.)
            if (smooth && inFrame(a) && inFrame(b)) {
                curves.push(catmullRomBezierEdge(a, b, beyondA, beyondB));
                return;
            }
            const clipped = clipSegmentToFrame(a, b, w, h);
            if (!clipped) return;
            const [p2, q2] = clipped;
            if (Math.hypot(q2.x - p2.x, q2.y - p2.y) < 1) return; // corner graze
            curves.push(Curve.line(p2, q2));
        };

        // Horizontal edges: interior rows only (1..rows-1). Rows 0 and `rows`
        // lie on the top/bottom border lines; emitting them would duplicate the
        // border curves (overlapping collinear segments).
        for (let j = 1; j < rows; j++) {
            for (let k = kMin; k < kMax; k++) {
                pushEdge(pos(j, k), pos(j, k + 1), maybePos(j, k - 1), maybePos(j, k + 2));
            }
        }

        // Diagonal edges: each node in rows 0..rows-1 connects to its two
        // neighbours in the row below. Emitted once from the upper node, so no
        // duplicates. Parity selects the down-left / down-right indices.
        for (let j = 0; j < rows; j++) {
            for (let k = kMin + 1; k < kMax; k++) {
                if (j % 2 === 0) {
                    // down-right (j,k) -> (j+1,k)
                    pushEdge(pos(j, k), pos(j + 1, k),
                        maybePos(j - 1, drStartK(j, k)), maybePos(j + 2, drK(j + 1, k)));
                    // down-left (j,k) -> (j+1,k-1)
                    pushEdge(pos(j, k), pos(j + 1, k - 1),
                        maybePos(j - 1, dlStartK(j, k)), maybePos(j + 2, dlK(j + 1, k - 1)));
                } else {
                    // down-right (j,k) -> (j+1,k+1)
                    pushEdge(pos(j, k), pos(j + 1, k + 1),
                        maybePos(j - 1, drStartK(j, k)), maybePos(j + 2, drK(j + 1, k + 1)));
                    // down-left (j,k) -> (j+1,k)
                    pushEdge(pos(j, k), pos(j + 1, k),
                        maybePos(j - 1, dlStartK(j, k)), maybePos(j + 2, dlK(j + 1, k)));
                }
            }
        }

        return curves;
    },
};
