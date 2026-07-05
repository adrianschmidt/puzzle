/**
 * Contour extraction for a traced region: boundary walk along pixel
 * edges, Douglas-Peucker simplification, Catmull-Rom smoothing.
 *
 * Coordinates are RASTER coordinates throughout; the caller scales to
 * frame space. All three stages are deterministic.
 */
import type { Point } from '../../model/types.js';

/**
 * Trace the outer boundary of a component as a closed polygon.
 *
 * Walks directed pixel-edge segments with the region interior on the
 * LEFT. At each corner the walker prefers the tightest left turn,
 * which keeps diagonal-touch cases (two region pixels meeting only at
 * a corner) on the outer boundary rather than crossing through.
 * Collinear steps are merged, so the result contains corners only.
 * First point is the region's topmost-leftmost boundary corner.
 *
 * Only the outer boundary is traced: a region with an interior hole
 * (a donut-shaped color blob) becomes a filled outline, its hole
 * swallowed into the piece. Acceptable for the v1 "coherent color
 * blob" model; revisit if hole-aware tracing is ever wanted.
 */
export function traceContour(
    width: number,
    height: number,
    componentMap: Int32Array,
    regionId: number,
): Point[] {
    const inside = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < width && y < height &&
        componentMap[y * width + x] === regionId;

    // Find the topmost-leftmost inside pixel. We walk boundary edges with
    // the region interior on the RIGHT of travel, then reverse at the end
    // so the returned polygon has interior on the LEFT.
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (inside(x, y)) { sx = x; sy = y; break outer; }
        }
    }
    if (sx < 0) return [];

    // Directions: 0=right, 1=down, 2=left, 3=up. Position = lattice corner.
    // For a unit edge leaving corner (cx,cy) in direction d, the adjacent
    // pixels are (derived per direction — do not compute one from the
    // other via reversal; the tables are corner-anchored and asymmetric):
    //   d=0 edge (cx,cy)→(cx+1,cy): left=(cx,cy-1)   right=(cx,cy)
    //   d=1 edge (cx,cy)→(cx,cy+1): left=(cx,cy)     right=(cx-1,cy)
    //   d=2 edge (cx,cy)→(cx-1,cy): left=(cx-1,cy)   right=(cx-1,cy-1)
    //   d=3 edge (cx,cy)→(cx,cy-1): left=(cx-1,cy-1) right=(cx,cy-1)
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const LEFT_DX = [0, 0, -1, -1],  LEFT_DY = [-1, 0, 0, -1];
    const RIGHT_DX = [0, -1, -1, 0], RIGHT_DY = [0, 0, -1, -1];
    const isBoundaryEdge = (cx: number, cy: number, d: number): boolean =>
        !inside(cx + LEFT_DX[d], cy + LEFT_DY[d]) &&
        inside(cx + RIGHT_DX[d], cy + RIGHT_DY[d]);

    // Start at the top-left corner of the first pixel, heading right:
    // left = (sx, sy-1) is outside (topmost row), right = (sx, sy) is
    // inside — a valid interior-on-right boundary edge.
    const startX = sx, startY = sy, startD = 0;
    const corners: Point[] = [];
    let cx = startX, cy = startY, d = startD;
    let guard = 0;
    const maxSteps = width * height * 8;
    do {
        corners.push({ x: cx, y: cy });
        // Advance one lattice step.
        cx += DX[d]; cy += DY[d];
        // Choose the next boundary edge. Prefer the turn TOWARD the
        // interior (right turn under interior-on-right), then straight,
        // then away — this keeps diagonal-touch corners from producing a
        // self-crossing walk. With y-down screen coords and the direction
        // ring 0→1→2→3 being right→down→left→up, "toward the interior"
        // is (d+1)%4.
        const turns = [(d + 1) % 4, d, (d + 3) % 4, (d + 2) % 4];
        let chosen = -1;
        for (const nd of turns) {
            if (isBoundaryEdge(cx, cy, nd)) { chosen = nd; break; }
        }
        if (chosen < 0) break; // defensive: malformed map
        d = chosen;
        guard++;
    } while ((cx !== startX || cy !== startY || d !== startD) && guard < maxSteps);

    // Merge collinear runs (the walk pushes every lattice corner).
    const merged: Point[] = [];
    for (let i = 0; i < corners.length; i++) {
        const prev = corners[(i - 1 + corners.length) % corners.length];
        const cur = corners[i];
        const next = corners[(i + 1) % corners.length];
        const collinear = (cur.x - prev.x) * (next.y - cur.y)
                       === (cur.y - prev.y) * (next.x - cur.x);
        if (!collinear) merged.push(cur);
    }

    // Interior currently on the right (clockwise in screen coords, which is
    // positive shoelace with y-down). Reverse to interior-on-left so hole
    // orientation matches the DCEL's expectations for island components.
    let area = 0;
    for (let i = 0; i < merged.length; i++) {
        const a = merged[i], b = merged[(i + 1) % merged.length];
        area += a.x * b.y - b.x * a.y;
    }
    if (area > 0) merged.reverse();
    return merged;
}

/** Douglas-Peucker on a closed loop: anchor at the two farthest-apart points. */
export function simplifyClosed(points: Point[], tolerance: number): Point[] {
    if (points.length <= 4) return [...points];
    // Farthest pair by scanning from point 0 (adequate + deterministic).
    let far = 1, best = -1;
    for (let i = 1; i < points.length; i++) {
        const d = dist(points[0], points[i]);
        if (d > best) { best = d; far = i; }
    }
    const half1 = dpSimplify([...points.slice(0, far + 1)], tolerance);
    const half2 = dpSimplify([...points.slice(far), points[0]], tolerance);
    return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

function dpSimplify(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;
    const first = points[0], last = points[points.length - 1];
    let index = -1, maxDist = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDist(points[i], first, last);
        if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist <= tolerance) return [first, last];
    const left = dpSimplify(points.slice(0, index + 1), tolerance);
    const right = dpSimplify(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
}

function perpendicularDist(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return dist(p, a);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function dist(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Closed Catmull-Rom → cubic Bézier path through the polygon corners.
 * `strength` scales the tangent handles: 0 = straight edges (degenerate
 * Béziers), 1 = full Catmull-Rom smoothness.
 * Returns 3n+1 points with first === last (Curve.fromBezierPath format).
 */
export function smoothClosed(points: Point[], strength: number): Point[] {
    const n = points.length;
    const path: Point[] = [points[0]];
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        const s = strength / 6;
        path.push(
            { x: p1.x + (p2.x - p0.x) * s, y: p1.y + (p2.y - p0.y) * s },
            { x: p2.x - (p3.x - p1.x) * s, y: p2.y - (p3.y - p1.y) * s },
            { x: p2.x, y: p2.y },
        );
    }
    return path;
}
