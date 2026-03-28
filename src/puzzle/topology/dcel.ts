/**
 * DCEL (Doubly-Connected Edge List) for planar subdivision.
 *
 * Given a set of curves that may intersect, finds all enclosed faces.
 * Each face becomes a puzzle piece in the topology-driven pipeline.
 *
 * Algorithm:
 * 1. Find all pairwise intersections between curves
 * 2. Split curves at intersection points → curve segments
 * 3. Create vertices (with tolerance-based merging)
 * 4. For each segment, create twin half-edges
 * 5. At each vertex, sort outgoing half-edges by angle
 * 6. Link half-edges via the "next" pointer (CW face traversal)
 * 7. Traverse "next" chains to discover faces
 * 8. Identify and exclude the outer (unbounded) face
 *
 * See issue #168 for the design discussion.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { CurveIntersection } from './curve.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vertex {
    id: number;
    position: Point;
    /** One of the outgoing half-edges (for traversal entry). */
    outgoing: HalfEdge | null;
}

export interface HalfEdge {
    id: number;
    origin: Vertex;
    twin: HalfEdge;
    next: HalfEdge;
    prev: HalfEdge;
    face: Face | null;
    /** The curve segment this half-edge represents (in the direction of travel). */
    curve: Curve;
}

export interface Face {
    id: number;
    /** One of the half-edges on this face's boundary. */
    outerEdge: HalfEdge;
    /** Whether this is the unbounded outer face. */
    isOuter: boolean;
}

/**
 * Input to the DCEL builder: a set of curves with optional
 * non-intersecting group hints for performance.
 */
export interface CutSet {
    curves: Curve[];
    /**
     * Optional: groups of curves known not to intersect each other.
     * The builder skips intersection checks within each group.
     */
    nonIntersectingGroups?: Curve[][];
}

/**
 * The result of building a DCEL from a set of curves.
 */
export interface DCELResult {
    vertices: Vertex[];
    halfEdges: HalfEdge[];
    faces: Face[];
    outerFace: Face;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Distance threshold for merging nearby vertices. */
const VERTEX_MERGE_TOLERANCE = 0.5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DCEL from a set of curves.
 *
 * @param cutSet - The input curves (with optional non-intersecting hints)
 * @returns The complete DCEL with vertices, half-edges, and faces
 */
export function buildDCEL(cutSet: CutSet): DCELResult {
    const { curves, nonIntersectingGroups } = cutSet;

    // Step 1: Find all intersections
    const allIntersections = findAllIntersections(curves, nonIntersectingGroups);

    // Step 2: Split curves at intersection points → segments
    const segments = splitCurvesAtIntersections(curves, allIntersections);

    // Step 3: Build vertices with merging
    const vertexMap = new VertexPool();
    const halfEdges: HalfEdge[] = [];
    let nextHalfEdgeId = 0;

    // Step 4: Create twin half-edges for each segment
    for (const segment of segments) {
        const originVertex = vertexMap.getOrCreate(segment.start);
        const targetVertex = vertexMap.getOrCreate(segment.end);

        // Skip zero-length segments
        if (originVertex === targetVertex) continue;

        const he1 = {
            id: nextHalfEdgeId++,
            origin: originVertex,
            curve: segment,
        } as unknown as HalfEdge;

        const he2 = {
            id: nextHalfEdgeId++,
            origin: targetVertex,
            curve: segment.reverse(),
        } as unknown as HalfEdge;

        he1.twin = he2;
        he2.twin = he1;
        he1.face = null;
        he2.face = null;
        // next/prev set later
        he1.next = he1; // placeholder
        he1.prev = he1;
        he2.next = he2;
        he2.prev = he2;

        halfEdges.push(he1, he2);

        // Register outgoing half-edges on vertices
        if (!originVertex.outgoing) originVertex.outgoing = he1;
        if (!targetVertex.outgoing) targetVertex.outgoing = he2;
    }

    const vertices = vertexMap.all();

    // Step 5: At each vertex, sort outgoing half-edges by angle and link next pointers
    linkHalfEdges(vertices, halfEdges);

    // Step 6: Discover faces
    const faces = discoverFaces(halfEdges);

    // Step 7: Identify the outer face (largest area, negative signed area = CW)
    const outerFace = identifyOuterFace(faces);

    return { vertices, halfEdges, faces, outerFace };
}

// ---------------------------------------------------------------------------
// Step 1: Find all intersections
// ---------------------------------------------------------------------------

interface CurveIntersectionRecord {
    curveIndexA: number;
    curveIndexB: number;
    intersection: CurveIntersection;
}

function findAllIntersections(
    curves: Curve[],
    nonIntersectingGroups?: Curve[][],
): CurveIntersectionRecord[] {
    const results: CurveIntersectionRecord[] = [];

    // Build a set of curve pairs to skip (within the same non-intersecting group)
    const skipPairs = new Set<string>();
    if (nonIntersectingGroups) {
        for (const group of nonIntersectingGroups) {
            const indices = group.map(c => curves.indexOf(c)).filter(i => i >= 0);
            for (let i = 0; i < indices.length; i++) {
                for (let j = i + 1; j < indices.length; j++) {
                    skipPairs.add(`${indices[i]},${indices[j]}`);
                }
            }
        }
    }

    for (let i = 0; i < curves.length; i++) {
        for (let j = i + 1; j < curves.length; j++) {
            if (skipPairs.has(`${i},${j}`)) continue;

            // Standard crossing intersections
            const intersections = curves[i].intersect(curves[j]);
            for (const ix of intersections) {
                results.push({
                    curveIndexA: i,
                    curveIndexB: j,
                    intersection: ix,
                });
            }

            // T-junction detection: check if either curve's endpoints lie
            // on the other curve. This handles cuts that START or END on
            // another curve (e.g. internal cuts meeting the border).
            addEndpointOnCurve(curves[i], curves[j], i, j, results);
            addEndpointOnCurve(curves[j], curves[i], j, i, results);
        }
    }

    return results;
}

/**
 * Check if curve A's endpoints lie on curve B, and if so, add them
 * as intersection records (T-junctions).
 */
function addEndpointOnCurve(
    curveA: Curve,
    curveB: Curve,
    indexA: number,
    indexB: number,
    results: CurveIntersectionRecord[],
): void {
    const endpoints = [
        { point: curveA.start, tA: 0 },
        { point: curveA.end, tA: 1 },
    ];

    for (const { point, tA } of endpoints) {
        const tB = findPointOnCurve(curveB, point);
        if (tB === null) continue;

        // Skip if this is a shared endpoint (both curves meet at the same point)
        // — those are handled naturally by vertex merging
        if ((tB < 1e-4 || tB > 1 - 1e-4) && (tA < 1e-4 || tA > 1 - 1e-4)) {
            // Both are at an endpoint — this is a shared vertex, not a T-junction
            continue;
        }

        // Check for duplicate
        const isDuplicate = results.some(
            r => pointDist(r.intersection.point, point) < VERTEX_MERGE_TOLERANCE,
        );
        if (isDuplicate) continue;

        results.push({
            curveIndexA: indexA,
            curveIndexB: indexB,
            intersection: {
                point,
                tSelf: tA,
                tOther: tB,
            },
        });
    }
}

/**
 * Find the parameter t on a curve where a point lies, or null if the point
 * is not on the curve (within tolerance).
 */
function findPointOnCurve(curve: Curve, point: Point): number | null {
    const pts = curve.toPolyline(16);
    let bestT = 0;
    let bestDist = Infinity;
    const totalSegments = pts.length - 1;

    for (let i = 0; i < pts.length - 1; i++) {
        const { t: segT, dist: d } = closestPointOnSegment(pts[i], pts[i + 1], point);
        if (d < bestDist) {
            bestDist = d;
            bestT = (i + segT) / totalSegments;
        }
    }

    return bestDist < VERTEX_MERGE_TOLERANCE * 2 ? bestT : null;
}

/**
 * Find the closest point on a line segment to a given point.
 */
function closestPointOnSegment(
    a: Point, b: Point, p: Point,
): { t: number; dist: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-10) {
        return { t: 0, dist: pointDist(a, p) };
    }

    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    return { t, dist: pointDist(proj, p) };
}

// ---------------------------------------------------------------------------
// Step 2: Split curves at intersections
// ---------------------------------------------------------------------------

function splitCurvesAtIntersections(
    curves: Curve[],
    intersections: CurveIntersectionRecord[],
): Curve[] {
    // Collect split parameters per curve
    const splitParams: Map<number, number[]> = new Map();

    for (const record of intersections) {
        const { curveIndexA, curveIndexB, intersection } = record;

        if (!splitParams.has(curveIndexA)) splitParams.set(curveIndexA, []);
        if (!splitParams.has(curveIndexB)) splitParams.set(curveIndexB, []);

        splitParams.get(curveIndexA)!.push(intersection.tSelf);
        splitParams.get(curveIndexB)!.push(intersection.tOther);
    }

    const allSegments: Curve[] = [];

    for (let i = 0; i < curves.length; i++) {
        const params = splitParams.get(i);
        if (!params || params.length === 0) {
            allSegments.push(curves[i]);
            continue;
        }

        // Sort and deduplicate split parameters
        const sorted = [...new Set(params.map(t => Math.round(t * 1e6) / 1e6))]
            .sort((a, b) => a - b)
            .filter(t => t > 1e-6 && t < 1 - 1e-6);

        if (sorted.length === 0) {
            allSegments.push(curves[i]);
            continue;
        }

        // Split the curve at each parameter
        let remaining = curves[i];
        let consumed = 0; // track how much of the original t-space we've consumed

        for (const t of sorted) {
            // Remap t from original space to remaining curve space
            const remapped = (t - consumed) / (1 - consumed);
            if (remapped <= 1e-6 || remapped >= 1 - 1e-6) continue;

            const [left, right] = remaining.splitAt(remapped);
            allSegments.push(left);
            remaining = right;
            consumed = t;
        }
        allSegments.push(remaining);
    }

    return allSegments;
}

// ---------------------------------------------------------------------------
// Vertex pool with tolerance-based merging
// ---------------------------------------------------------------------------

class VertexPool {
    private vertices: Vertex[] = [];
    private nextId = 0;

    getOrCreate(point: Point): Vertex {
        // Find existing vertex within tolerance
        for (const v of this.vertices) {
            if (pointDist(v.position, point) < VERTEX_MERGE_TOLERANCE) {
                return v;
            }
        }

        const v: Vertex = {
            id: this.nextId++,
            position: { x: point.x, y: point.y },
            outgoing: null,
        };
        this.vertices.push(v);
        return v;
    }

    all(): Vertex[] {
        return this.vertices;
    }
}

// ---------------------------------------------------------------------------
// Step 5: Link half-edges via angle sorting
// ---------------------------------------------------------------------------

function linkHalfEdges(_vertices: Vertex[], halfEdges: HalfEdge[]): void {
    // Group outgoing half-edges by origin vertex
    const outgoingByVertex = new Map<number, HalfEdge[]>();

    for (const he of halfEdges) {
        const vid = he.origin.id;
        if (!outgoingByVertex.has(vid)) outgoingByVertex.set(vid, []);
        outgoingByVertex.get(vid)!.push(he);
    }

    // At each vertex, sort outgoing half-edges by angle and link next pointers.
    //
    // In screen coordinates (Y-down), atan2 ascending order = CW visual order.
    // For CW inner face traversal (standard with Y-down), when arriving at a
    // vertex we take the rightmost turn: outgoing[i].twin.next = outgoing[i-1]
    // (the previous edge in CW order).
    for (const [_vid, outgoing] of outgoingByVertex) {
        if (outgoing.length <= 1) {
            if (outgoing.length === 1) {
                outgoing[0].twin.next = outgoing[0];
                outgoing[0].prev = outgoing[0].twin;
            }
            continue;
        }

        // Sort by outgoing angle (ascending = CW in screen space)
        outgoing.sort((a, b) => outgoingAngle(a) - outgoingAngle(b));

        // Link: outgoing[i].twin.next = outgoing[(i-1+n) % n]
        // This produces CW inner faces in screen coords (positive signed area).
        const n = outgoing.length;
        for (let i = 0; i < n; i++) {
            const prevInCW = outgoing[(i - 1 + n) % n];
            outgoing[i].twin.next = prevInCW;
            prevInCW.prev = outgoing[i].twin;
        }
    }
}

/**
 * Compute the outgoing angle of a half-edge from its origin.
 * Uses the tangent at t=0 of the half-edge's curve.
 */
function outgoingAngle(he: HalfEdge): number {
    const t = he.curve.tangentAt(0);
    return Math.atan2(t.y, t.x);
}

// ---------------------------------------------------------------------------
// Step 6: Discover faces
// ---------------------------------------------------------------------------

function discoverFaces(halfEdges: HalfEdge[]): Face[] {
    const visited = new Set<number>();
    const faces: Face[] = [];
    let nextFaceId = 0;

    for (const he of halfEdges) {
        if (visited.has(he.id)) continue;

        // Walk the face boundary
        const face: Face = {
            id: nextFaceId++,
            outerEdge: he,
            isOuter: false,
        };

        let current = he;
        do {
            visited.add(current.id);
            current.face = face;
            current = current.next;
        } while (current !== he);

        faces.push(face);
    }

    return faces;
}

// ---------------------------------------------------------------------------
// Step 7: Identify outer face
// ---------------------------------------------------------------------------

function identifyOuterFace(faces: Face[]): Face {
    // The outer face has the largest absolute area (or negative signed area
    // if we're using CW winding for inner faces).
    // In practice, the outer face is the one with the most negative signed area
    // (CW winding in screen coords where Y grows downward).
    let outerFace = faces[0];
    let mostNegativeArea = Infinity;

    for (const face of faces) {
        const area = computeSignedArea(face);
        if (area < mostNegativeArea) {
            mostNegativeArea = area;
            outerFace = face;
        }
    }

    outerFace.isOuter = true;
    return outerFace;
}

/**
 * Compute the signed area of a face by walking its half-edge boundary.
 * Uses the shoelace formula on the half-edge endpoints.
 *
 * In screen coordinates (Y down):
 * - Positive area = CCW winding (inner face)
 * - Negative area = CW winding (outer face)
 */
function computeSignedArea(face: Face): number {
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

// ---------------------------------------------------------------------------
// Utility: get face boundary as points
// ---------------------------------------------------------------------------

/**
 * Walk a face boundary and collect the vertex positions.
 */
export function getFaceVertices(face: Face): Point[] {
    const points: Point[] = [];
    let current = face.outerEdge;
    do {
        points.push(current.origin.position);
        current = current.next;
    } while (current !== face.outerEdge);
    return points;
}

/**
 * Walk a face boundary and collect the half-edges.
 */
export function getFaceEdges(face: Face): HalfEdge[] {
    const edges: HalfEdge[] = [];
    let current = face.outerEdge;
    do {
        edges.push(current);
        current = current.next;
    } while (current !== face.outerEdge);
    return edges;
}

/**
 * Count the number of half-edges around a face.
 */
export function countFaceEdges(face: Face): number {
    let count = 0;
    let current = face.outerEdge;
    do {
        count++;
        current = current.next;
    } while (current !== face.outerEdge);
    return count;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pointDist(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
