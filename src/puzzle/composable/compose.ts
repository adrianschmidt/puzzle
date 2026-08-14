/**
 * Edge-based composition — no grid concepts (rows, columns, directions).
 */

import type { GeneratedEdge, GeneratedPiece, Point } from '../../model/types.js';
import type { PieceDefinition, EdgeDefinition } from './types.js';
import type { TabTemplate } from './tab-shapes.js';
import type { BezierPath } from './bezier-path.js';
import {
    bezierPathToSvg,
    mirrorBezierPathY,
    reverseBezierPath,
} from './bezier-path.js';
import { clampTabToCurve } from './curve-clamp.js';
import { buildShape, fmt } from '../../model/build-shape.js';

export interface ComposeOptions {
    /** Skip tab generation; all shared edges become flat lines. */
    disableTabs?: boolean;
}

/**
 * @param template - Tab shape template; read only when tabs are enabled. May
 *   be `null` for callers with their own tab geometry (e.g. the topology
 *   pipeline, which writes tabs into edge curves before calling here).
 */
export function composePuzzle(
    pieceDefs: PieceDefinition[],
    template: TabTemplate | null,
    random: () => number,
    options?: ComposeOptions,
): GeneratedPiece[] {
    const disableTabs = options?.disableTabs ?? false;
    const tabPaths = new Map<string, BezierPath>();
    const tabIsTab = new Map<string, boolean>();

    if (!disableTabs) {
        if (!template) {
            throw new Error('composePuzzle: template is required when tabs are enabled');
        }
        for (const pieceDef of pieceDefs) {
            for (const edge of pieceDef.edges) {
                if (edge.sharedEdgeKey && edge.isFirstSide && !tabPaths.has(edge.sharedEdgeKey)) {
                    const isTab = random() > 0.5;
                    tabIsTab.set(edge.sharedEdgeKey, isTab);

                    let normalizedPath = template.generate(random);
                    if (!isTab) {
                        normalizedPath = mirrorBezierPathY(normalizedPath);
                    }

                    tabPaths.set(edge.sharedEdgeKey, normalizedPath);
                }
            }
        }
    }

    return pieceDefs.map(pieceDef => {
        const edges: GeneratedEdge[] = pieceDef.edges.map(edgeDef =>
            buildEdge(edgeDef, tabPaths),
        );
        const shape = buildShape(edges);
        return {
            id: pieceDef.id,
            edges,
            shape,
            imageOffset: pieceDef.imageOffset,
        };
    });
}

/**
 * Skips the first point (assumed to be the moveTo/previous endpoint).
 */
function curvePointsToSvg(points: Point[]): string {
    return points.slice(1).map(p => `L ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

function fallbackPath(edgeDef: EdgeDefinition): string {
    if (edgeDef.curvePoints && edgeDef.curvePoints.length > 2) {
        return curvePointsToSvg(edgeDef.curvePoints);
    }
    return `L ${fmt(edgeDef.end.x)} ${fmt(edgeDef.end.y)}`;
}

function buildEdge(
    edgeDef: EdgeDefinition,
    tabPaths: Map<string, BezierPath>,
): GeneratedEdge {
    const { id, start, end, mateEdgeId, matePieceId, sharedEdgeKey, isFirstSide, curvePoints } = edgeDef;
    const carryCurvePoints = curvePoints ? { curvePoints } : {};

    if (mateEdgeId === -1 || !sharedEdgeKey) {
        return {
            id,
            mateEdgeId: -1,
            matePieceId: -1,
            path: fallbackPath(edgeDef),
            start,
            end,
            ...carryCurvePoints,
        };
    }

    const normalizedPath = tabPaths.get(sharedEdgeKey);
    if (!normalizedPath) {
        return {
            id,
            mateEdgeId,
            matePieceId,
            path: fallbackPath(edgeDef),
            start,
            end,
            ...carryCurvePoints,
        };
    }

    let pathToTransform = normalizedPath;
    if (!isFirstSide) {
        pathToTransform = reverseBezierPath(normalizedPath);
    }

    if (curvePoints && curvePoints.length > 2) {
        const orientedCurve = isFirstSide ? curvePoints : [...curvePoints].reverse();
        const result = clampTabToCurve(orientedCurve, pathToTransform);
        return {
            id,
            mateEdgeId,
            matePieceId,
            path: result.svgPath,
            start,
            end,
            ...carryCurvePoints,
        };
    }

    const transformed = transformToEdge(pathToTransform, start, end);

    return {
        id,
        mateEdgeId,
        matePieceId,
        path: bezierPathToSvg(transformed),
        start,
        end,
        ...carryCurvePoints,
    };
}

/**
 * Transform a BezierPath from normalized space ((0,0)→(1,0), +Y protrusion)
 * to edge coordinates (start→end) via the tangent/normal frame — the
 * tangent/normal vectors are the rotation, so no explicit angles.
 */
function transformToEdge(
    path: BezierPath,
    start: Point,
    end: Point,
): BezierPath {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Perpendicular (90° CCW — tab protrudes left of travel)
    const px = -dy;
    const py = dx;

    // The template may not span [0,1] — normalize first.
    const xMin = path[0].x;
    const xMax = path[path.length - 1].x;
    const xRange = xMax - xMin || 1;

    return path.map(p => {
        const normX = (p.x - xMin) / xRange;
        const normY = p.y / xRange;
        return {
            x: start.x + normX * dx + normY * px,
            y: start.y + normX * dy + normY * py,
        };
    });
}
