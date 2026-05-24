/**
 * Composition layer for the composable puzzle generator.
 *
 * Takes PieceDefinitions (abstract edges with mate relationships)
 * and a TabTemplate, and produces the final Piece[] by:
 * 1. For each shared edge's first side: generate a tab in normalized space
 * 2. For each shared edge's second side: reverse the stored tab
 * 3. Transform tab paths onto actual edge endpoints using tangent/normal frame
 * 4. Build SVG paths and assemble Piece objects
 *
 * No grid-specific concepts (rows, columns, directions) — just edges.
 *
 * See issue #154 and docs/composable-reference/tab-clamping-reference.md
 * for the coordinate frame approach.
 */

import type { Edge, Piece, Point } from '../../model/types.js';
import type { PieceDefinition, EdgeDefinition } from './types.js';
import type { TabTemplate } from './tab-shapes.js';
import type { BezierPath } from './bezier-path.js';
import {
    bezierPathToSvg,
    fmt,
    mirrorBezierPathY,
    reverseBezierPath,
} from './bezier-path.js';
import { clampTabToCurve } from './curve-clamp.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for the composition step.
 */
export interface ComposeOptions {
    /** When true, skip tab generation entirely — all shared edges are flat lines. */
    disableTabs?: boolean;
}

/**
 * Compose a puzzle from piece definitions.
 *
 * @param pieceDefs - Abstract piece definitions from the grid layer
 * @param template - Tab shape template; only read when tabs are
 *   enabled (`options.disableTabs` falsy). May be `null` for callers
 *   that bring their own tab geometry — e.g. the topology pipeline,
 *   which writes tabs directly into edge curves before calling here.
 * @param random - Seeded PRNG for tab assignment and shape variation
 * @returns Complete Piece[] ready for the game engine
 */
export function composePuzzle(
    pieceDefs: PieceDefinition[],
    template: TabTemplate | null,
    random: () => number,
    options?: ComposeOptions,
): Piece[] {
    const disableTabs = options?.disableTabs ?? false;
    // Step 1: Generate tab shapes for all shared edges.
    // Store in normalized space by shared edge key.
    // Skip entirely when tabs are disabled.
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

    // Step 2: Build pieces
    return pieceDefs.map(pieceDef => {
        const edges: Edge[] = pieceDef.edges.map(edgeDef =>
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

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

/**
 * Convert curvePoints to an SVG polyline path string (L commands).
 * Skips the first point (assumed to be the moveTo/previous endpoint).
 */
function curvePointsToSvg(points: Point[]): string {
    return points.slice(1).map(p => `L ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

/**
 * Fallback path: either a polyline from curvePoints or a straight line.
 */
function fallbackPath(edgeDef: EdgeDefinition): string {
    if (edgeDef.curvePoints && edgeDef.curvePoints.length > 2) {
        return curvePointsToSvg(edgeDef.curvePoints);
    }
    return `L ${fmt(edgeDef.end.x)} ${fmt(edgeDef.end.y)}`;
}

function buildEdge(
    edgeDef: EdgeDefinition,
    tabPaths: Map<string, BezierPath>,
): Edge {
    const { id, start, end, mateEdgeId, matePieceId, sharedEdgeKey, isFirstSide, curvePoints } = edgeDef;
    const carryCurvePoints = curvePoints ? { curvePoints } : {};

    // Border edge: follow curve if available, otherwise straight
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

    // Shared edge: get the normalized tab path
    const normalizedPath = tabPaths.get(sharedEdgeKey);
    if (!normalizedPath) {
        // No tab (tabs disabled): follow the curve
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

    // For second side, reverse the normalized path
    let pathToTransform = normalizedPath;
    if (!isFirstSide) {
        pathToTransform = reverseBezierPath(normalizedPath);
    }

    // For curved edges, use curve-clamped tab placement.
    // For straight edges, use the simple start→end transform.
    if (curvePoints && curvePoints.length > 2) {
        // Curved edge: clamp tab to the actual curve
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

    // Straight edge: transform using tangent/normal frame from start→end
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

// ---------------------------------------------------------------------------
// Coordinate transform — tangent/normal frame
// ---------------------------------------------------------------------------

/**
 * Transform a BezierPath from normalized space ((0,0)→(1,0), +Y protrusion)
 * to actual edge coordinates (start→end) using the tangent/normal frame.
 *
 * This is the core of the tab-clamping approach:
 *   T = normalize(end - start)    // tangent along the edge
 *   N = perpendicular(T)          // normal (protrusion direction)
 *   canvas = start + lx * (end - start) + ly * N * edgeLength
 *
 * No explicit rotation angles — the tangent/normal vectors ARE the rotation.
 */
function transformToEdge(
    path: BezierPath,
    start: Point,
    end: Point,
): BezierPath {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Perpendicular (90° counterclockwise — tab protrudes to the left of travel)
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

// ---------------------------------------------------------------------------
// SVG path helpers
// ---------------------------------------------------------------------------

/**
 * Build the SVG `d` string from a flat list of edges. Loop boundaries
 * are detected implicitly: each edge that does not pick up where the
 * previous one ended starts a new `M..Z` subpath.
 */
function buildShape(edges: Edge[]): string {
    if (edges.length === 0) return '';
    const parts: string[] = [];
    let prevEnd: Point | null = null;
    for (const edge of edges) {
        const continuesChain =
            prevEnd !== null
            && Math.abs(prevEnd.x - edge.start.x) < CHAIN_EPSILON
            && Math.abs(prevEnd.y - edge.start.y) < CHAIN_EPSILON;
        if (!continuesChain) {
            if (parts.length > 0) parts.push('Z');
            parts.push(`M ${fmt(edge.start.x)} ${fmt(edge.start.y)}`);
        }
        parts.push(edge.path);
        prevEnd = edge.end;
    }
    parts.push('Z');
    return parts.join(' ');
}

/** Tolerance for matching consecutive edges' end→start in piece-local px. */
const CHAIN_EPSILON = 0.5;

