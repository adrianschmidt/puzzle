/**
 * Convert DCEL faces to PieceDefinition[] for the existing composition layer.
 *
 * This is the bridge between the topology system and the rendering pipeline.
 * Each inner face becomes a PieceDefinition; each half-edge becomes an
 * EdgeDefinition with mate relationships derived from DCEL twins.
 *
 * See issue #171 for design discussion.
 */

import type { Point } from '../../model/types.js';
import type { PieceDefinition, EdgeDefinition } from '../composable/types.js';
import type { Face, HalfEdge, DCELResult } from './dcel.js';
import { getFaceEdges } from './dcel.js';
import type { MateAnalysis } from './mate-detection.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert DCEL faces to PieceDefinition[] for the composition layer.
 *
 * @param dcel - The DCEL result from buildDCEL()
 * @param mateAnalysis - Mate analysis from analyzeMates()
 * @returns Array of PieceDefinitions ready for composePuzzle()
 */
export function facesToPieceDefinitions(
    dcel: DCELResult,
    mateAnalysis: MateAnalysis,
): PieceDefinition[] {
    const innerFaces = dcel.faces.filter(f => !f.isOuter);

    // Assign piece IDs: face ID → piece ID mapping
    const faceIdToPieceId = new Map<number, number>();
    innerFaces.forEach((face, index) => {
        faceIdToPieceId.set(face.id, index);
    });

    // Assign edge IDs: half-edge ID → edge ID mapping
    let nextEdgeId = 0;
    const halfEdgeToEdgeId = new Map<number, number>();
    for (const face of innerFaces) {
        const edges = getFaceEdges(face);
        for (const he of edges) {
            if (!halfEdgeToEdgeId.has(he.id)) {
                halfEdgeToEdgeId.set(he.id, nextEdgeId++);
            }
            // Also assign twin's edge ID if not yet assigned
            if (!halfEdgeToEdgeId.has(he.twin.id)) {
                halfEdgeToEdgeId.set(he.twin.id, nextEdgeId++);
            }
        }
    }

    return innerFaces.map(face => {
        const pieceId = faceIdToPieceId.get(face.id)!;
        const halfEdges = getFaceEdges(face);

        // Compute bounding box for image offset
        const bbox = computeFaceBBox(halfEdges);

        // Convert half-edges to EdgeDefinitions
        const edges: EdgeDefinition[] = halfEdges.map(he => {
            return halfEdgeToEdgeDef(
                he, bbox, faceIdToPieceId, halfEdgeToEdgeId, mateAnalysis,
            );
        });

        return {
            id: pieceId,
            edges,
            imageOffset: { x: -bbox.minX, y: -bbox.minY },
        };
    });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Compute the bounding box of a face from its half-edge vertices.
 */
function computeFaceBBox(halfEdges: HalfEdge[]): BBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const he of halfEdges) {
        // Sample the curve for accurate bbox (especially for curved edges)
        const pts = he.curve.toPolyline(8);
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Convert a half-edge to an EdgeDefinition.
 */
function halfEdgeToEdgeDef(
    he: HalfEdge,
    bbox: BBox,
    faceIdToPieceId: Map<number, number>,
    halfEdgeToEdgeId: Map<number, number>,
    mateAnalysis: MateAnalysis,
): EdgeDefinition {
    const origin = he.origin.position;
    const target = he.twin.origin.position;

    // Convert to piece-local coordinates (relative to bbox top-left)
    const start: Point = {
        x: origin.x - bbox.minX,
        y: origin.y - bbox.minY,
    };
    const end: Point = {
        x: target.x - bbox.minX,
        y: target.y - bbox.minY,
    };

    const edgeId = halfEdgeToEdgeId.get(he.id)!;
    const twinFace = he.twin.face;
    const isBorder = !twinFace || twinFace.isOuter;

    if (isBorder) {
        return {
            id: edgeId,
            start,
            end,
            mateEdgeId: -1,
            matePieceId: -1,
            curvePoints: extractCurvePoints(he, bbox),
        };
    }

    // Shared edge
    const matePieceId = faceIdToPieceId.get(twinFace.id) ?? -1;
    const mateEdgeId = halfEdgeToEdgeId.get(he.twin.id) ?? -1;

    // Determine shared edge key and first-side convention
    const minHalfEdgeId = Math.min(he.id, he.twin.id);
    const maxHalfEdgeId = Math.max(he.id, he.twin.id);
    const sharedEdgeKey = `he_${minHalfEdgeId}_${maxHalfEdgeId}`;
    const isFirstSide = he.id === minHalfEdgeId;

    return {
        id: edgeId,
        start,
        end,
        mateEdgeId,
        matePieceId,
        sharedEdgeKey,
        isFirstSide,
        curvePoints: extractCurvePoints(he, bbox),
    };
}

/**
 * Extract curve points from a half-edge in piece-local coordinates.
 * Returns undefined for straight edges (to save space).
 */
function extractCurvePoints(he: HalfEdge, bbox: BBox): Point[] | undefined {
    // Check if the curve is essentially straight
    const pts = he.curve.toPolyline(8);
    if (isEssentiallyStraight(pts)) {
        return undefined;
    }

    // Convert to piece-local coordinates
    return pts.map(p => ({
        x: p.x - bbox.minX,
        y: p.y - bbox.minY,
    }));
}

/**
 * Check if a polyline is essentially a straight line.
 */
function isEssentiallyStraight(pts: Point[], tolerance = 0.5): boolean {
    if (pts.length <= 2) return true;

    const start = pts[0];
    const end = pts[pts.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1e-6) return true;

    // Check max deviation from the line
    const nx = -dy / len;
    const ny = dx / len;

    for (let i = 1; i < pts.length - 1; i++) {
        const px = pts[i].x - start.x;
        const py = pts[i].y - start.y;
        const deviation = Math.abs(px * nx + py * ny);
        if (deviation > tolerance) return false;
    }

    return true;
}
