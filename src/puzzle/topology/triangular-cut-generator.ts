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
}

/** Map a [0,1) float onto a 32-bit integer seed (CLAUDE.md sub-PRNG helper). */
function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

/**
 * Worst-case budget on the TOTAL number of lattice curves this generator may
 * emit. The lattice emits ~`3 · rows · cols` single-segment curves (one
 * horizontal + two diagonal families), and that whole set is fed to
 * `buildDCEL`, whose intersection pass (`findAllIntersections`) and vertex pool
 * (`VertexPool.getOrCreate`) are both O(n²) with no spatial index — so DCEL
 * cost grows with the SQUARE of the curve count. Bounding the curve count to a
 * few thousand keeps that n²/2 comfortably sub-second.
 *
 * Neither dimension is bounded by the share-link decode clamps on its own:
 *   - `cols` is NOT the grid `cols` the caller passes; it is derived from the
 *     frame aspect ratio (`cols ≈ (w/h)·rows·√3/2`), and no decode clamp bounds
 *     the aspect ratio. A crafted extreme-aspect link (`is:[8192,1]`) derives
 *     hundreds of thousands of columns.
 *   - `rows` is normally the grid rows (decode-clamped to 64), but the opaque
 *     `baseCutConfig` (share-link `cf.bgc`) is spread over it in the topology
 *     generator AFTER the clamp, so a crafted `cf.bgc.rows = 1e6` flows in
 *     unbounded.
 * Either alone (or both together) would otherwise emit tens of millions of
 * curves and freeze the main thread for minutes inside the O(n²) DCEL.
 *
 * The budget squeezes `cols` so total curves stay ≤ ~TARGET_MAX_CURVES for any
 * `rows` (curves ≈ 3·rows·cols, and cols ≤ TARGET_MAX_CURVES/(3·rows)), and
 * {@link MAX_ROWS} independently bounds the O(rows) node-allocation loop
 * against the `bgc.rows` override.
 *
 * Value chosen to be a no-op for every typical landscape puzzle while reining
 * the crafted case down to a comparable ceiling. The largest real puzzle is the
 * 16×12 grid (rows = 12); at rows = 12 the per-row column budget is
 * floor(2000 / 36) = 55, and the derived column count is cols ≈ (w/h)·rows·√3/2,
 * so the budget first engages at an aspect of ~5.34:1. A typical landscape
 * Unsplash photo (or the 1080×720 blank) sits well under that (a 5:1 panorama
 * derives ~52 columns, ≈ 1900 curves), so the budget is a no-op for them and
 * does not perturb their geometry or jitter draw order.
 *
 * It is NOT a strict no-op for every conceivable puzzle: a genuinely ultrawide
 * max-size panorama wider than ~5.34:1 at rows = 12 derives more than 55 columns
 * and IS clamped, compressing its horizontal lattice slightly. That clamp is
 * deterministic — it runs identically on sender and receiver from the same
 * inputs — so it is a bounded, deliberate geometry trade-off, not a
 * reproducibility break (and triangular is unreleased, so no existing share link
 * depends on the unclamped geometry).
 *
 * It is deliberately NOT lower: the DCEL's intersection/vertex passes are
 * O(n²) in the curve count (empirically a 16×12 wide puzzle already runs a few
 * seconds), so a sub-second worst case would require a budget below the typical
 * landscape ceiling, which would clamp ordinary wide puzzles and compress their
 * geometry — keeping the budget a no-op for typical puzzles wins. The win here
 * is eliminating the DoS *amplification*: a crafted `is:[8192,1]`, `g:[*,64]`
 * link drops from tens of millions of curves (~450k columns — a multi-minute /
 * effectively unbounded O(n²) main-thread freeze) to the bounded ~2000-curve
 * ceiling (a few seconds), so a share link can no longer cost more than the
 * worst puzzle a user could already build. Capping here (rather than at decode)
 * also protects the dev console and any future entry point.
 */
const TARGET_MAX_CURVES = 2000;

/**
 * Hard upper bound on the triangle-row count, bounding the O(rows · cols)
 * node-allocation loop against the `cf.bgc.rows` override described above.
 * Set to 64 to match the share-link `MAX_GRID_DIM` grid-dimension clamp, so it
 * is a strict no-op for every value the grid decoder can produce (legitimate
 * UI puzzles top out at rows = 12; the whole crafted-ceiling range up to 64
 * still passes through unchanged) — only a `bgc.rows` override above the grid
 * clamp is reined in. Because it never engages for any decoder-reachable row
 * count, it cannot perturb a legitimate puzzle's geometry or jitter draws.
 */
const MAX_ROWS = 64;

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

export const triangularCutGenerator: BaseCutGenerator = {
    id: 'triangular',
    // supportsBorderless intentionally omitted (falsy): a jittered, partial-edge
    // tiling has no clean 1-deep rectangular ring for strip-border-ring.ts.

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<TriangularCutConfig>;
        // MAX_ROWS bounds the node-allocation loop against a crafted
        // `cf.bgc.rows` override; it equals the grid-dim decode clamp, so it is
        // a no-op for every legitimate (and dev-console) row count.
        const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(cfg.rows ?? 1)));
        const jitter = Math.min(0.5, Math.max(0, cfg.jitter ?? 0.15));
        const w = frame.width;
        const h = frame.height;

        // ONE outer draw seeds the local sub-PRNG; every jitter draw uses
        // `local`, so the outer stream advances by exactly one call regardless
        // of rows/jitter (reproducibility contract).
        const local = createSeededRandom(seedFromFloat(random()));

        const rowHeight = h / rows;
        // Equilateral side implied by the row height; used only to choose how
        // many whole columns best fit the width.
        const equilateralSide = (2 * rowHeight) / Math.sqrt(3);
        // Snap the horizontal spacing so a whole number of columns divides the
        // width exactly, aligning the lattice to the left/right borders (no
        // sliver column). Triangles become very slightly isoceles.
        // The total-curve budget caps the absurd extreme-aspect case (see
        // TARGET_MAX_CURVES): the lattice emits ~3·rows·cols curves, so the
        // per-row column budget keeps the total bounded for the O(n²) DCEL. A
        // normal puzzle derives far fewer columns than the budget and is
        // unaffected.
        const colBudget = Math.max(1, Math.floor(TARGET_MAX_CURVES / (3 * rows)));
        const cols = Math.min(colBudget, Math.max(1, Math.round(w / equilateralSide)));
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

        // Borders FIRST (top, right, bottom, left), per the contract.
        const curves: Curve[] = [
            Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
            Curve.line({ x: w, y: 0 }, { x: w, y: h }),
            Curve.line({ x: w, y: h }, { x: 0, y: h }),
            Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
        ];

        const pushEdge = (a: Point, b: Point): void => {
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
                pushEdge(pos(j, k), pos(j, k + 1));
            }
        }

        // Diagonal edges: each node in rows 0..rows-1 connects to its two
        // neighbours in the row below. Emitted once from the upper node, so no
        // duplicates. Parity selects the down-left / down-right indices.
        for (let j = 0; j < rows; j++) {
            for (let k = kMin + 1; k < kMax; k++) {
                if (j % 2 === 0) {
                    pushEdge(pos(j, k), pos(j + 1, k));     // down-right
                    pushEdge(pos(j, k), pos(j + 1, k - 1)); // down-left
                } else {
                    pushEdge(pos(j, k), pos(j + 1, k + 1)); // down-right
                    pushEdge(pos(j, k), pos(j + 1, k));     // down-left
                }
            }
        }

        return curves;
    },
};
