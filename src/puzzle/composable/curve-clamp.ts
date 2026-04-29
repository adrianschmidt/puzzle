/**
 * Tab clamping to arbitrary curves.
 *
 * Places a tab shape on a curve by:
 * 1. Finding anchor points at a fixed chord distance (bisection)
 * 2. Building a tangent/normal frame from those anchors
 * 3. Transforming the tab shape into the curve's local coordinate system
 * 4. Splicing the tab into the curve (replacing the segment between anchors)
 *
 * Based on the tab-clamping reference document.
 * See docs/composable-reference/tab-clamping-reference.md
 */

import type { Point } from '../../model/types.js';
import type { BezierPath } from './bezier-path.js';
import { bezierPathToSvg, fmt } from './bezier-path.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of clamping a tab to a curve: the full edge SVG path
 * with the tab spliced in.
 */
export interface ClampedTabResult {
    /** Full SVG path for the edge (curve + tab). */
    svgPath: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clamp a tab shape onto a curved edge.
 *
 * @param curvePoints - Dense sampling of the edge curve (piece-local coords).
 *                      First point = edge start, last = edge end.
 * @param tabPath - Tab shape in normalized space ((0,0)→(1,0), +Y protrusion)
 * @param tCenter - Where on the curve to place the tab (0–1). Default: 0.5
 * @param chordFraction - Tab chord as fraction of total curve length. Default: 0.4
 * @returns The full edge SVG path with the tab spliced in
 */
export function clampTabToCurve(
    curvePoints: Point[],
    tabPath: BezierPath,
    tCenter = 0.5,
    chordFraction = 0.4,
): ClampedTabResult {
    const totalLength = computePathLength(curvePoints);
    const desiredChord = totalLength * chordFraction;

    // Step 1: Bisect to find delta such that chord length = desiredChord
    const delta = bisectForChord(curvePoints, tCenter, desiredChord);

    const tLeft = Math.max(0, tCenter - delta);
    const tRight = Math.min(1, tCenter + delta);

    // Step 2: Get anchor points on the curve
    const pLeft = sampleCurveAt(curvePoints, tLeft);
    const pRight = sampleCurveAt(curvePoints, tRight);

    // Step 3: Build tangent/normal frame
    const dx = pRight.x - pLeft.x;
    const dy = pRight.y - pLeft.y;
    const span = Math.sqrt(dx * dx + dy * dy) || 1;
    const tx = dx / span;
    const ty = dy / span;
    // Normal: perpendicular, pointing left of travel direction (tab protrusion)
    const nx = ty;
    const ny = -tx;

    const mx = (pLeft.x + pRight.x) / 2;
    const my = (pLeft.y + pRight.y) / 2;

    // Step 4: Transform tab from normalized space to edge coords.
    // The template may not span [0,1] — normalize first.
    const xMin = tabPath[0].x;
    const xMax = tabPath[tabPath.length - 1].x;
    const xRange = xMax - xMin || 1;

    const transformedTab = tabPath.map(p => {
        const normX = (p.x - xMin) / xRange;  // normalize to [0,1]
        const lx = (normX - 0.5) * span;      // map to [-s, +s]
        const ly = (p.y / xRange) * span;     // scale y proportionally
        return {
            x: mx + lx * tx + ly * nx,
            y: my + lx * ty + ly * ny,
        };
    });

    // Step 5: Build SVG path — curve before tab + tab + curve after tab
    const iLeft = findNearestIndex(curvePoints, tLeft);
    const iRight = findNearestIndex(curvePoints, tRight);

    const parts: string[] = [];

    // Curve segment before the tab (from edge start to left anchor)
    for (let i = 1; i <= iLeft; i++) {
        parts.push(`L ${fmt(curvePoints[i].x)} ${fmt(curvePoints[i].y)}`);
    }
    // Line to exact left anchor (in case it's between sample points)
    parts.push(`L ${fmt(pLeft.x)} ${fmt(pLeft.y)}`);

    // Tab shape as Bézier commands
    parts.push(bezierPathToSvg(transformedTab));

    // Line from right anchor back to curve
    parts.push(`L ${fmt(pRight.x)} ${fmt(pRight.y)}`);
    // Curve segment after the tab (from right anchor to edge end)
    for (let i = iRight + 1; i < curvePoints.length; i++) {
        parts.push(`L ${fmt(curvePoints[i].x)} ${fmt(curvePoints[i].y)}`);
    }

    return { svgPath: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Bisection solver
// ---------------------------------------------------------------------------

/**
 * Find delta such that the chord between curve(tCenter-delta) and
 * curve(tCenter+delta) equals the desired length.
 */
function bisectForChord(
    points: Point[],
    tCenter: number,
    desiredChord: number,
): number {
    let lo = 0;
    let hi = 0.5;

    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const pL = sampleCurveAt(points, Math.max(0, tCenter - mid));
        const pR = sampleCurveAt(points, Math.min(1, tCenter + mid));
        const dx = pR.x - pL.x;
        const dy = pR.y - pL.y;
        const chord = Math.sqrt(dx * dx + dy * dy);
        if (chord < desiredChord) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Curve sampling helpers
// ---------------------------------------------------------------------------

/**
 * Sample a point on the curve at parameter t ∈ [0, 1].
 * Uses linear interpolation between the nearest sample points.
 */
function sampleCurveAt(points: Point[], t: number): Point {
    const clamped = Math.max(0, Math.min(1, t));
    const n = points.length - 1;
    const idx = clamped * n;
    const i = Math.floor(idx);

    if (i >= n) return points[n];

    const frac = idx - i;
    return {
        x: points[i].x + frac * (points[i + 1].x - points[i].x),
        y: points[i].y + frac * (points[i + 1].y - points[i].y),
    };
}

/**
 * Find the index of the nearest sample point to parameter t.
 */
function findNearestIndex(points: Point[], t: number): number {
    return Math.round(Math.max(0, Math.min(1, t)) * (points.length - 1));
}

/**
 * Compute the total path length of a series of points.
 */
function computePathLength(points: Point[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
}

