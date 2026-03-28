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
import type { TabTemplate, BezierPath } from './tab-shapes.js';
import { reverseBezierPath, mirrorBezierPathY } from './tab-shapes.js';
import { clampTabToCurve } from './curve-clamp.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose a puzzle from piece definitions and a tab template.
 *
 * @param pieceDefs - Abstract piece definitions from the grid layer
 * @param template - Tab shape template to use
 * @param random - Seeded PRNG for tab assignment and shape variation
 * @returns Complete Piece[] ready for the game engine
 */
/**
 * Options for the composition step.
 */
export interface ComposeOptions {
    /** When true, skip tab generation entirely — all shared edges are flat lines. */
    disableTabs?: boolean;
}

export function composePuzzle(
    pieceDefs: PieceDefinition[],
    template: TabTemplate,
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
    const { id, start, end, mateEdgeId, matePieceId, sharedEdgeKey, isFirstSide } = edgeDef;

    // Border edge: follow curve if available, otherwise straight
    if (mateEdgeId === -1 || !sharedEdgeKey) {
        return {
            id,
            mateEdgeId: -1,
            matePieceId: -1,
            path: fallbackPath(edgeDef),
            start,
            end,
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
        };
    }

    // For second side, reverse the normalized path
    let pathToTransform = normalizedPath;
    if (!isFirstSide) {
        pathToTransform = reverseBezierPath(normalizedPath);
    }

    // For curved edges, use curve-clamped tab placement.
    // For straight edges, use the simple start→end transform.
    if (edgeDef.curvePoints && edgeDef.curvePoints.length > 2) {
        // Curved edge: clamp tab to the actual curve
        const curvePoints = isFirstSide
            ? edgeDef.curvePoints
            : [...edgeDef.curvePoints].reverse();

        const result = clampTabToCurve(curvePoints, pathToTransform);
        return {
            id,
            mateEdgeId,
            matePieceId,
            path: result.svgPath,
            start,
            end,
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

    return path.map(p => ({
        x: start.x + p.x * dx + p.y * px,
        y: start.y + p.x * dy + p.y * py,
    }));
}

// ---------------------------------------------------------------------------
// SVG path helpers
// ---------------------------------------------------------------------------

function bezierPathToSvg(path: BezierPath): string {
    if (path.length < 4) {
        const last = path[path.length - 1];
        return `L ${fmt(last.x)} ${fmt(last.y)}`;
    }

    const parts: string[] = [];
    for (let i = 1; i < path.length; i += 3) {
        const cp1 = path[i];
        const cp2 = path[i + 1];
        const end = path[i + 2];
        parts.push(
            `C ${fmt(cp1.x)} ${fmt(cp1.y)}, ${fmt(cp2.x)} ${fmt(cp2.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
        );
    }

    return parts.join(' ');
}

function buildShape(edges: Edge[]): string {
    if (edges.length === 0) return '';
    const first = edges[0];
    const parts = [`M ${fmt(first.start.x)} ${fmt(first.start.y)}`];
    for (const edge of edges) {
        parts.push(edge.path);
    }
    parts.push('Z');
    return parts.join(' ');
}

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
