/**
 * Tiles the frame with near-equilateral triangles (horizontal plus ±60° line
 * families), emitted as deduplicated per-edge segments between shared lattice
 * vertices, NOT maximal full-frame lines. The DCEL builder merges coincident
 * endpoints (3px tolerance) and handles the degree-6 vertices a triangular
 * lattice produces.
 *
 * Horizontal column spacing is snapped so a whole number of columns divides the
 * frame width exactly, aligning the lattice to the left/right borders (clean
 * half-triangles, not slivers) at the cost of very slightly isosceles triangles.
 *
 * Border curves come first (top, right, bottom, left).
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
     *  lattice line share a tangent. No-op at jitter 0. Consumes no randomness. */
    smooth: boolean;
}

/** Map a [0,1) float onto a 32-bit integer seed (CLAUDE.md sub-PRNG helper). */
function seedFromFloat(v: number): number {
    return Math.floor(v * 4294967296);
}

/**
 * Worst-case budget on the TOTAL lattice curves this generator emits (~3·rows·cols,
 * all fed to buildDCEL). Since #439 the DCEL's intersection pass and vertex pool
 * are fronted by a spatial broad-phase (~O(n) for lattice geometry), so raw curve
 * count is cheap; the residual super-linear cost is lattice *fineness* — many rows
 * in a tight frame collapse vertical spacing toward the 3px vertex-merge tolerance.
 *
 * Neither crafted dimension is bounded by decode clamps alone: `cols` is derived
 * from the frame aspect ratio (cols ≈ (w/h)·rows·√3/2), and no clamp bounds aspect
 * (`is:[8192,1]` derives hundreds of thousands of columns); `rows` can be pushed via
 * `cf.bgc.rows`, spread over the config AFTER the decode clamp. This budget squeezes
 * cols so total curves stay ≤ ~TARGET_MAX_CURVES for any rows, and {@link MAX_ROWS}
 * caps the row count — together bounding fineness so the crafted worst case stays
 * ~4–5.25s (measured).
 *
 * Chosen so the clamp is a no-op across the real landscape range (up to ~20:1
 * panoramas at 192 pieces), engaging only on clearly-absurd aspects. Where it does
 * bind it is deterministic (identical on sender and receiver), so a bounded,
 * deliberate geometry trade-off, not a reproducibility break. Frozen as part of the
 * released Triangles share-link contract: it feeds both `generate`'s column budget
 * and {@link estimateTriangleFaceCount} → `selectTriangleRows`, so changing it would
 * re-derive the row count and lattice geometry for existing links wherever it binds.
 * Not higher on purpose: past the real-landscape ceiling it would only raise the
 * crafted worst case with no fidelity benefit.
 */
const TARGET_MAX_CURVES = 7500;

/**
 * Hard upper bound on the triangle-row count. Bounds the O(rows·cols) allocation
 * loop against a crafted `cf.bgc.rows` override, and caps the lattice fineness
 * that is the DCEL's dominant super-linear cost (see TARGET_MAX_CURVES).
 *
 * Set to 16: above the largest real puzzle (16×12, rows = 12), but
 * `selectTriangleRows` reaches it for extreme-portrait images at 192 pieces, so
 * it engages for real puzzles too. Deliberately BELOW the share-link MAX_GRID_DIM
 * (64) — an unclamped rows ≈ 64 in a tight frame would run several seconds; the
 * clamp only affects crafted links and is deterministic, so it doesn't break
 * reproducibility. Frozen as part of the share-link contract: `selectTriangleRows`
 * re-derives its row count from this cap on every decode, so raising it would
 * change the reproduced puzzle for any link capped at 16.
 */
export const MAX_ROWS = 16;

/**
 * Derive the lattice column count for a (clamped) row count and frame — the single
 * column derivation shared by `generate` and {@link estimateTriangleFaceCount}, so
 * the estimator can't drift from the real lattice. The equilateral side implied by
 * the row height picks how many whole columns fit the width (snapped so they divide
 * it exactly; triangles become very slightly isosceles). The total-curve budget
 * caps extreme-aspect cases (see {@link TARGET_MAX_CURVES}); every real landscape
 * (up to ~20:1) stays under it.
 *
 * Part of the released Triangles share-link contract. Exported for tests only.
 */
export function deriveTriangleColumns(rows: number, frame: Size): number {
    const rowHeight = frame.height / rows;
    const equilateralSide = (2 * rowHeight) / Math.sqrt(3);
    const colBudget = Math.max(1, Math.floor(TARGET_MAX_CURVES / (3 * rows)));
    return Math.min(colBudget, Math.max(1, Math.round(frame.width / equilateralSide)));
}

/**
 * Estimate the face count the lattice produces for a row count and frame — the
 * sizing input for the Triangles aspect-adaptive row selection. Shares
 * {@link deriveTriangleColumns} with `generate`, so it tracks the real column math.
 * Exact for jitter 0 / smooth false (each strip = 2·cols full triangles + two
 * border halves); the preset's jitter/bowing can add or drop the odd micro-face.
 *
 * Part of the share-link contract: `selectTriangleRows` re-derives the row count
 * from this on every decode, so changing the formula changes what a link reproduces.
 */
export function estimateTriangleFaceCount(rows: number, frame: Size): number {
    const r = Math.min(MAX_ROWS, Math.max(1, Math.floor(rows)));
    const cols = deriveTriangleColumns(r, frame);
    return r * (2 * cols + 1);
}

/**
 * Border / jitter inset margin, in pixels, on top of the jitter reach. Must stay
 * ≥ the DCEL's VERTEX_MERGE_TOLERANCE (3px, private in dcel.ts) so a jittered node
 * or clipped border endpoint can't land within merge distance of the frame edge —
 * which would fuse a lattice vertex onto the border curve and corrupt the face set.
 * Kept in sync by hand; if dcel.ts raises it, raise this too.
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
            if (q[i] < 0) return null;
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
 * One cubic Bézier for cut edge a→b, bowed so its endpoint tangents match adjacent
 * edges on the same lattice line (uniform Catmull-Rom → Bézier). `beyondA`/`beyondB`
 * are the crossings before/after; undefined at a chain end uses the straight control
 * point (== Curve.line). At jitter 0 (collinear, evenly spaced) it reproduces an
 * exact straight line.
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
    // supportsBorderless omitted (falsy): a jittered, partial-edge tiling has no
    // clean 1-deep rectangular ring for strip-border-ring.ts.

    generate(frame: Size, random: () => number, config: unknown): Curve[] {
        const cfg = (config ?? {}) as Partial<TriangularCutConfig>;
        // MAX_ROWS bounds the allocation loop and lattice fineness against a
        // crafted `cf.bgc.rows` override; a no-op above the largest real 12 rows.
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
        // Snap horizontal spacing so whole columns divide the width exactly (no
        // sliver column); see deriveTriangleColumns for the snap and budget clamp.
        const cols = deriveTriangleColumns(rows, frame);
        const colStep = w / cols;
        // Cell size for jitter magnitude / border inset — smaller axis so a
        // jittered vertex can't reach a neighbour or border.
        const cell = Math.min(colStep, rowHeight);

        // One column past each side so border half-triangle diagonals exist and
        // clip onto the frame; even-row k=0/k=cols land exactly on the borders.
        const kMin = -1;
        const kMax = cols + 1;

        // Precompute node positions in FIXED (j,k) order so the jitter draw order
        // is deterministic; edge emission only reads these.
        const nodes = new Map<string, Point>();
        // Only jitter nodes comfortably inside the frame, so they stay clear of
        // the border and the 3px merge tolerance.
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
                    // Half-way rule: never let jitter carry a node more than
                    // half-way to a frame edge. The inset gate only decides WHICH
                    // nodes jitter; without this clamp a border-adjacent odd-row
                    // node at jitter ~0.5 could land near the 3px merge margin,
                    // squashing a degree-6 crossing against the border (sliver
                    // faces, bowed control points dragged out of frame). The 3px
                    // clearance itself never depended on this clamp (the gate
                    // already keeps every landing >3px clear); it only tightens the
                    // sliver band, and is a structural no-op for other node classes.
                    px = Math.max(x / 2, Math.min((x + w) / 2, px));
                    py = Math.max(y / 2, Math.min((y + h) / 2, py));
                }
                nodes.set(key(j, k), { x: px, y: py });
            }
        }
        const pos = (j: number, k: number): Point => nodes.get(key(j, k))!;

        // Neighbor lattice direction helpers. `maybePos` returns undefined
        // off-lattice (smoothed edge stays straight at a chain end) and also when
        // `smooth` is off, so the smooth-off path builds no keys / does no Map.gets
        // for beyond-neighbors.
        const maybePos = (j: number, k: number): Point | undefined =>
            smooth ? nodes.get(key(j, k)) : undefined;
        const even = (j: number) => j % 2 === 0;
        const drK = (j: number, k: number) => even(j) ? k : k + 1;   // down-right col, row j+1
        const dlK = (j: number, k: number) => even(j) ? k - 1 : k;   // down-left col, row j+1
        // Beyond-start neighbor (row j-1) continuing each diagonal line upward:
        // the node whose down-right / down-left neighbor is (j,k).
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
            // Fringe edges with an endpoint outside the frame fall through to the
            // clip below.
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

        // Horizontal edges: interior rows only (1..rows-1). Rows 0 and `rows` lie
        // on the top/bottom borders; emitting them would duplicate those curves.
        for (let j = 1; j < rows; j++) {
            for (let k = kMin; k < kMax; k++) {
                pushEdge(pos(j, k), pos(j, k + 1), maybePos(j, k - 1), maybePos(j, k + 2));
            }
        }

        // Diagonal edges: each node in rows 0..rows-1 connects to its two
        // neighbours below, emitted once from the upper node (no duplicates).
        // Parity selects the down-left / down-right indices.
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
