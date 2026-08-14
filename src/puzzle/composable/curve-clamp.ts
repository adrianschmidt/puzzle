import type { Point } from '../../model/types.js';
import { fmt } from '../../model/build-shape.js';
import type { BezierPath } from './bezier-path.js';
import { bezierPathToSvg } from './bezier-path.js';

export interface ClampedTabResult {
    svgPath: string;
}

/**
 * @param curvePoints - Dense sampling of the edge curve (piece-local coords);
 *                      first = edge start, last = edge end.
 * @param tabPath - Tab shape in normalized space ((0,0)→(1,0), +Y protrusion).
 * @param tCenter - Where on the curve to place the tab (0–1).
 * @param chordFraction - Tab chord as fraction of total curve length.
 */
export function clampTabToCurve(
    curvePoints: Point[],
    tabPath: BezierPath,
    tCenter = 0.5,
    chordFraction = 0.4,
): ClampedTabResult {
    const totalLength = computePathLength(curvePoints);
    const desiredChord = totalLength * chordFraction;

    const delta = bisectForChord(curvePoints, tCenter, desiredChord);

    const tLeft = Math.max(0, tCenter - delta);
    const tRight = Math.min(1, tCenter + delta);

    const pLeft = sampleCurveAt(curvePoints, tLeft);
    const pRight = sampleCurveAt(curvePoints, tRight);

    const dx = pRight.x - pLeft.x;
    const dy = pRight.y - pLeft.y;
    const span = Math.sqrt(dx * dx + dy * dy) || 1;
    const tx = dx / span;
    const ty = dy / span;
    // Normal: perpendicular, left of travel (tab protrusion)
    const nx = ty;
    const ny = -tx;

    const mx = (pLeft.x + pRight.x) / 2;
    const my = (pLeft.y + pRight.y) / 2;

    // The template may not span [0,1] — normalize first.
    const xMin = tabPath[0].x;
    const xMax = tabPath[tabPath.length - 1].x;
    const xRange = xMax - xMin || 1;

    const transformedTab = tabPath.map(p => {
        const normX = (p.x - xMin) / xRange;
        const lx = (normX - 0.5) * span;
        const ly = (p.y / xRange) * span;
        return {
            x: mx + lx * tx + ly * nx,
            y: my + lx * ty + ly * ny,
        };
    });

    const iLeft = findNearestIndex(curvePoints, tLeft);
    const iRight = findNearestIndex(curvePoints, tRight);

    const parts: string[] = [];

    for (let i = 1; i <= iLeft; i++) {
        parts.push(`L ${fmt(curvePoints[i].x)} ${fmt(curvePoints[i].y)}`);
    }
    // Exact left anchor (may fall between sample points)
    parts.push(`L ${fmt(pLeft.x)} ${fmt(pLeft.y)}`);

    parts.push(bezierPathToSvg(transformedTab));

    parts.push(`L ${fmt(pRight.x)} ${fmt(pRight.y)}`);
    for (let i = iRight + 1; i < curvePoints.length; i++) {
        parts.push(`L ${fmt(curvePoints[i].x)} ${fmt(curvePoints[i].y)}`);
    }

    return { svgPath: parts.join(' ') };
}

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

function findNearestIndex(points: Point[], t: number): number {
    return Math.round(Math.max(0, Math.min(1, t)) * (points.length - 1));
}

function computePathLength(points: Point[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
}

