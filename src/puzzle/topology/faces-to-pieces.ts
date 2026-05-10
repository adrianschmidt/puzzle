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
import type { HalfEdge, Face, TopologyGraph } from './dcel.js';
import { getFaceEdges, countFaceEdges } from './dcel.js';
import { diagnostics } from '../../diagnostics.js';

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
    dcel: TopologyGraph,
    expectedPieceCount?: number,
): PieceDefinition[] {
    // Merge degenerate lens-shaped and tiny tip faces into adjacent faces
    // instead of discarding them, which would leave holes. See issues
    // #219, #220.
    mergeSmallFaces(dcel, expectedPieceCount);

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
        // Also walk each inner-boundary loop so its half-edges (and
        // their twins) get edge IDs assigned. Without this, the
        // halfEdgeToEdgeDef call below would throw when converting
        // inner-boundary edges.
        for (const innerStart of face.innerBoundaries) {
            const innerEdges = walkLoop(innerStart);
            for (const he of innerEdges) {
                if (!halfEdgeToEdgeId.has(he.id)) {
                    halfEdgeToEdgeId.set(he.id, nextEdgeId++);
                }
                if (!halfEdgeToEdgeId.has(he.twin.id)) {
                    halfEdgeToEdgeId.set(he.twin.id, nextEdgeId++);
                }
            }
        }
    }

    return innerFaces.map(face => {
        const pieceId = faceIdToPieceId.get(face.id)!;
        const outerHE = getFaceEdges(face);

        // Compute bounding box for image offset (based on the OUTER
        // boundary — inner-boundary edges are inside the outer
        // boundary by definition, so don't extend the bbox).
        const bbox = computeFaceBBox(outerHE);

        // Flat edge list: outer boundary first, then each inner-
        // boundary loop appended. Loop boundaries are implicit —
        // detected by the renderer when consecutive edges' end/start
        // points don't match. All loops share the same piece-local
        // coordinate frame (the same bbox).
        const allHE: HalfEdge[] = [...outerHE];
        for (const innerStart of face.innerBoundaries) {
            allHE.push(...walkLoop(innerStart));
        }

        const edges: EdgeDefinition[] = allHE.map(he =>
            halfEdgeToEdgeDef(he, bbox, faceIdToPieceId, halfEdgeToEdgeId),
        );

        return {
            id: pieceId,
            edges,
            imageOffset: { x: -bbox.minX, y: -bbox.minY },
        };
    });
}

/**
 * Walk a half-edge loop starting at `start`, returning all half-edges
 * in cyclic order following `next` pointers.
 */
function walkLoop(start: HalfEdge): HalfEdge[] {
    const loop: HalfEdge[] = [];
    let current = start;
    do {
        loop.push(current);
        current = current.next;
    } while (current !== start);
    return loop;
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
 * Merge degenerate and tiny faces into adjacent faces.
 *
 * Two classes of unwanted faces arise from excess intersections between
 * high-amplitude sine-wave cuts:
 *
 * 1. **Lens faces (≤2 edges)**: Created by pairwise excess intersection
 *    resolution. These have area ≈ 0.
 *
 * 2. **Tip faces (3–4 edges, tiny area)**: Created where three or more
 *    sine waves converge, forming small triangular/quad regions that
 *    the pairwise detector can't eliminate.
 *
 * Both are merged into an adjacent non-outer face by removing one shared
 * edge and splicing the remaining edges into the neighbor's boundary.
 *
 * Mutates the DCEL in-place.
 */
function mergeSmallFaces(dcel: TopologyGraph, expectedPieceCount?: number): void {
    // A face is merged if:
    // 1. It has ≤2 edges (degenerate lens face), OR
    // 2. Its area is tiny relative to ALL its non-outer neighbors
    //    (ratio < NEIGHBOR_RATIO). This catches 3+ edge "tip" faces
    //    formed where multiple sine waves converge.
    const NEIGHBOR_RATIO = 0.10;

    // Protect faces that participate in registered inner-boundary
    // (hole) loops. These are intentional structures from
    // assignHoles() — merging them would invalidate stored
    // innerBoundaries half-edge pointers. We protect both the loop
    // faces themselves and the "inside the hole" faces reached
    // through their twins, since those are part of the same inner
    // component.
    const protectedFaces = collectProtectedFaces(dcel);

    let changed = true;
    while (changed) {
        changed = false;

        // Stop merging if we've reached the expected piece count
        // (prevents over-merging when some grid cells fused)
        if (expectedPieceCount !== undefined) {
            const innerCount = dcel.faces.filter(f => !f.isOuter).length;
            if (innerCount <= expectedPieceCount) break;
        }

        for (let i = dcel.faces.length - 1; i >= 0; i--) {
            const face = dcel.faces[i];
            if (face.isOuter) continue;
            if (protectedFaces.has(face)) continue;

            const edgeCount = countFaceEdges(face);

            if (edgeCount <= 1) {
                // Degenerate self-loop — just remove it
                dcel.faces.splice(i, 1);
                changed = true;
                break;
            }

            let shouldMerge: boolean;
            if (edgeCount <= 2) {
                shouldMerge = true;
            } else if (expectedPieceCount !== undefined) {
                // Only apply area-based merging when we know the expected
                // piece count and have excess faces to merge. Without a
                // target count, small 3+ edge faces are kept as-is.
                shouldMerge = isTinyRelativeToNeighbors(face, NEIGHBOR_RATIO);
            } else {
                shouldMerge = false;
            }

            if (!shouldMerge) continue;

            diagnostics.log('merge', `Merging face ${face.id}: edges=${edgeCount}, area=${computeFaceSignedArea(face).toFixed(1)}`);

            // Find a shared edge whose twin belongs to a non-outer neighbor
            const edges = getFaceEdges(face);
            let removedEdge: HalfEdge | null = null;
            let targetFace: Face | null = null;

            for (const he of edges) {
                const neighbor = he.twin.face;
                if (neighbor && !neighbor.isOuter) {
                    removedEdge = he;
                    targetFace = neighbor;
                    break;
                }
            }

            if (!removedEdge || !targetFace) {
                // All neighbors are outer — remove the face
                dcel.faces.splice(i, 1);
                changed = true;
                break;
            }

            const removedTwin = removedEdge.twin;

            // Collect the remaining edges (all edges except removedEdge)
            const keptEdges: HalfEdge[] = [];
            for (const he of edges) {
                if (he !== removedEdge) keptEdges.push(he);
            }

            // Splice the kept edges into the target face's boundary,
            // replacing removedTwin.
            //
            // removedEdge goes A→B in the small face.
            // removedTwin goes B→A in the target face.
            // keptEdges go B→...→A (completing the small face's boundary).
            // So replacing removedTwin with keptEdges preserves winding.
            const firstKept = keptEdges[0];
            const lastKept = keptEdges[keptEdges.length - 1];

            removedTwin.prev.next = firstKept;
            firstKept.prev = removedTwin.prev;
            lastKept.next = removedTwin.next;
            removedTwin.next.prev = lastKept;

            for (const he of keptEdges) {
                he.face = targetFace;
            }

            if (targetFace.outerEdge === removedTwin) {
                targetFace.outerEdge = firstKept;
            }

            // Update vertex outgoing pointers if they referenced removed edges
            if (removedEdge.origin.outgoing === removedEdge) {
                removedEdge.origin.outgoing =
                    dcel.halfEdges.find(h =>
                        h.origin === removedEdge!.origin &&
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

/**
 * Collect the set of faces that must not be merged because they
 * participate in a registered inner-boundary (hole) loop.
 *
 * For each loop start half-edge in any face's `innerBoundaries`:
 * - Walk the loop and protect each half-edge's face.
 * - Also protect the twin's face on each step (= the face on the
 *   "inside" of the hole), so the entire inner-component subgraph
 *   is left untouched.
 */
function collectProtectedFaces(dcel: TopologyGraph): Set<Face> {
    const protectedFaces = new Set<Face>();
    for (const face of dcel.faces) {
        for (const start of face.innerBoundaries) {
            let current = start;
            do {
                if (current.face) protectedFaces.add(current.face);
                if (current.twin.face) protectedFaces.add(current.twin.face);
                current = current.next;
            } while (current !== start);
        }
    }
    return protectedFaces;
}

/**
 * Compute the signed area of a face using the shoelace formula.
 */
function computeFaceSignedArea(face: Face): number {
    let area = 0;
    let current = face.outerEdge;
    do {
        const a = current.origin.position;
        const b = current.twin.origin.position;
        area += (a.x * b.y - b.x * a.y);
        current = current.next;
    } while (current !== face.outerEdge);
    return area / 2;
}

/**
 * Check if a face is tiny relative to its largest non-outer neighbor.
 * Returns true if the face's area is less than `ratio` times the
 * largest neighbor's area. Using the largest neighbor (not the
 * smallest) handles the case where two adjacent tip faces are similar
 * in size — as long as one large neighbor exists, the face is merged.
 */
function isTinyRelativeToNeighbors(face: Face, ratio: number): boolean {
    const faceArea = Math.abs(computeFaceSignedArea(face));
    const edges = getFaceEdges(face);

    // Find the largest non-outer neighbor face
    let maxNeighborArea = 0;
    for (const he of edges) {
        const neighbor = he.twin.face;
        if (neighbor && !neighbor.isOuter && neighbor !== face) {
            const neighborArea = Math.abs(computeFaceSignedArea(neighbor));
            if (neighborArea > maxNeighborArea) {
                maxNeighborArea = neighborArea;
            }
        }
    }

    if (maxNeighborArea === 0) return false;

    if (faceArea < maxNeighborArea * ratio) {
        diagnostics.log('merge', `Face ${face.id} is tiny: area=${faceArea.toFixed(1)}, largest neighbor=${maxNeighborArea.toFixed(1)}`);
        return true;
    }
    return false;
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
