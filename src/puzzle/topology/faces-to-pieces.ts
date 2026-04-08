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
import type { HalfEdge, Face, DCELResult } from './dcel.js';
import { getFaceEdges } from './dcel.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert DCEL faces to PieceDefinition[] for the composition layer.
 *
 * @param dcel - The DCEL result from buildDCEL()
 * @returns Array of PieceDefinitions ready for composePuzzle()
 */
export function facesToPieceDefinitions(
    dcel: DCELResult,
): PieceDefinition[] {
    // Merge degenerate lens-shaped faces (≤2 edges) into adjacent faces
    // instead of discarding them, which would leave holes. See issues
    // #219, #220.
    mergeSmallFaces(dcel);

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
                he, bbox, faceIdToPieceId, halfEdgeToEdgeId,
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

/**
 * Count the number of edges (half-edges) bounding a face.
 */
function countFaceEdges(face: Face): number {
    let count = 0;
    let he = face.outerEdge;
    do {
        count++;
        he = he.next;
    } while (he !== face.outerEdge);
    return count;
}

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
        const pts = he.curve.sample(8);
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
    const pts = he.curve.sample(8);
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
 * Merge degenerate faces (≤2 edges) into an adjacent face.
 *
 * Excess intersections between sine-wave cuts can create tiny lens-shaped
 * faces with exactly 2 edges. Previously these were filtered out, but that
 * left holes in the puzzle. Instead, we remove the shared edge between the
 * small face and a neighbor, absorbing the small face's remaining edges
 * into the neighbor's boundary.
 *
 * Mutates the DCEL in-place.
 */
function mergeSmallFaces(dcel: DCELResult): void {
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = dcel.faces.length - 1; i >= 0; i--) {
            const face = dcel.faces[i];
            if (face.isOuter) continue;

            const edgeCount = countFaceEdges(face);
            if (edgeCount > 2) continue;

            if (edgeCount <= 1) {
                // Degenerate self-loop — just remove it
                dcel.faces.splice(i, 1);
                changed = true;
                break;
            }

            // 2-edge lens face: E1(A→B) → E2(B→A) → E1
            const e1 = face.outerEdge;
            const e2 = e1.next;
            if (e2.next !== e1) continue; // sanity check

            // Pick a non-outer neighbor to merge into
            const n1 = e1.twin.face;
            const n2 = e2.twin.face;

            let removedEdge: HalfEdge;
            let keptEdge: HalfEdge;
            let targetFace: Face;

            if (n1 && !n1.isOuter) {
                removedEdge = e1;
                keptEdge = e2;
                targetFace = n1;
            } else if (n2 && !n2.isOuter) {
                removedEdge = e2;
                keptEdge = e1;
                targetFace = n2;
            } else {
                // Both neighbors are outer — remove the face
                dcel.faces.splice(i, 1);
                changed = true;
                break;
            }

            const removedTwin = removedEdge.twin;

            // Splice keptEdge into targetFace's boundary, replacing removedTwin.
            // Both keptEdge and removedTwin traverse the same vertex pair in the
            // same direction, so the boundary winding is preserved.
            removedTwin.prev.next = keptEdge;
            keptEdge.prev = removedTwin.prev;
            keptEdge.next = removedTwin.next;
            removedTwin.next.prev = keptEdge;

            keptEdge.face = targetFace;

            if (targetFace.outerEdge === removedTwin) {
                targetFace.outerEdge = keptEdge;
            }

            // Update vertex outgoing pointers if they referenced removed edges
            if (removedEdge.origin.outgoing === removedEdge) {
                removedEdge.origin.outgoing =
                    dcel.halfEdges.find(h =>
                        h.origin === removedEdge.origin &&
                        h !== removedEdge && h !== removedTwin,
                    ) ?? null;
            }
            if (removedTwin.origin.outgoing === removedTwin) {
                removedTwin.origin.outgoing =
                    dcel.halfEdges.find(h =>
                        h.origin === removedTwin.origin &&
                        h !== removedEdge && h !== removedTwin,
                    ) ?? null;
            }

            // Remove face and edges
            dcel.faces.splice(i, 1);
            removeFromArray(dcel.halfEdges, removedEdge);
            removeFromArray(dcel.halfEdges, removedTwin);

            changed = true;
            break; // restart scan — indices changed
        }
    }
}

function removeFromArray<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx >= 0) arr.splice(idx, 1);
}

/**
 * Check if a set of sampled points is essentially a straight line.
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
