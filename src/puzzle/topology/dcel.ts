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
import { findComponents } from './components.js';
import { assignHoles } from './holes.js';

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

/**
 * Construction-only shape for half-edges. The cyclic fields (`twin`, `next`,
 * `prev`) cannot be populated at allocation time, so they start as null and
 * are wired up by `makeTwinPair` (twins) and Step 5 `linkHalfEdges`
 * (next/prev). Narrowed to `HalfEdge` once wiring is complete.
 */
interface MutableHalfEdge {
    id: number;
    origin: Vertex;
    twin: MutableHalfEdge | null;
    next: MutableHalfEdge | null;
    prev: MutableHalfEdge | null;
    face: Face | null;
    curve: Curve;
}

export interface Face {
    id: number;
    /** One of the half-edges on this face's boundary. */
    outerEdge: HalfEdge;
    /** Whether this is the unbounded outer face. */
    isOuter: boolean;
    /**
     * Inner-boundary loop starting half-edges. Empty for faces
     * without holes. One half-edge per loop; walk via .next to
     * collect the full loop.
     */
    innerBoundaries: HalfEdge[];
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
 * A topology graph: vertices (intersection points), half-edges
 * (oriented arcs between vertices, each carrying a curve), and faces
 * (regions enclosed by half-edge cycles).
 *
 * Implemented as a DCEL (Doubly-Connected Edge List). Built once from
 * a set of input cuts, then never re-derived — subsequent stages
 * (tab application, face → piece extraction) operate on this graph
 * directly.
 */
export interface TopologyGraph {
    vertices: Vertex[];
    halfEdges: HalfEdge[];
    faces: Face[];
    outerFace: Face;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Distance threshold for merging nearby vertices. */
const VERTEX_MERGE_TOLERANCE = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DCEL from a set of curves.
 *
 * @param cutSet - The input curves (with optional non-intersecting hints)
 * @returns The complete DCEL with vertices, half-edges, and faces
 */
export function buildDCEL(cutSet: CutSet): TopologyGraph {
    const { curves, nonIntersectingGroups } = cutSet;

    // Step 1: Find all intersections
    const allIntersections = findAllIntersections(
        curves, nonIntersectingGroups,
    );

    // Step 2: Split curves at intersection points → segments
    let segments = splitCurvesAtIntersections(curves, allIntersections);

    // Step 2b: Split closed curves (start === end) at t=0.5 to create two half-edges
    segments = splitClosedCurves(segments);

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

        const [he1, he2] = makeTwinPair(
            nextHalfEdgeId, nextHalfEdgeId + 1,
            originVertex, targetVertex, segment,
        );
        nextHalfEdgeId += 2;

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

    // Step 8: Detect connected components and assign holes (inner
    // boundaries) for non-primary components contained in inner faces.
    const result: TopologyGraph = { vertices, halfEdges, faces, outerFace };
    const components = findComponents(result);
    assignHoles(result, components);
    return result;
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
    const lastSeg = curveA.segments.length - 1;
    const endpoints = [
        { point: curveA.start, tA: 0, segA: 0, tLocalA: 0 },
        { point: curveA.end, tA: 1, segA: lastSeg, tLocalA: 1 },
    ];

    for (const { point, tA, segA, tLocalA } of endpoints) {
        const result = findPointOnCurve(curveB, point);
        if (result === null) continue;

        // Skip if this is a shared endpoint (both curves meet at the same point)
        if ((result.globalT < 1e-4 || result.globalT > 1 - 1e-4) &&
            (tA < 1e-4 || tA > 1 - 1e-4)) {
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
                tOther: result.globalT,
                segSelf: segA,
                tLocalSelf: tLocalA,
                segOther: result.segmentIndex,
                tLocalOther: result.localT,
            },
        });
    }
}

/**
 * Result of finding a point on a curve: both global and segment-level info.
 */
interface PointOnCurveResult {
    globalT: number;
    segmentIndex: number;
    localT: number;
}

/**
 * Find where a point lies on a curve, or null if the point
 * is not on the curve (within tolerance).
 * Returns both global t and segment-level info for precise splitting.
 */
function findPointOnCurve(curve: Curve, point: Point): PointOnCurveResult | null {
    const n = curve.segments.length;
    let bestSeg = 0;
    let bestLocalT = 0;
    let bestDist = Infinity;

    for (let i = 0; i < n; i++) {
        const proj = curve['beziers'][i].project({ x: point.x, y: point.y });
        const d = pointDist(proj, point);
        if (d < bestDist) {
            bestDist = d;
            bestSeg = i;
            bestLocalT = proj.t ?? 0;
        }
    }

    if (bestDist >= VERTEX_MERGE_TOLERANCE * 2) return null;

    return {
        globalT: (bestSeg + bestLocalT) / n,
        segmentIndex: bestSeg,
        localT: bestLocalT,
    };
}

// ---------------------------------------------------------------------------
// Step 2: Split curves at intersections
// ---------------------------------------------------------------------------

/**
 * A split point on a curve, identified by segment index + local t.
 * No global t conversion needed — this is exact.
 */
interface SegmentSplit {
    segmentIndex: number;
    localT: number;
}

function splitCurvesAtIntersections(
    curves: Curve[],
    intersections: CurveIntersectionRecord[],
): Curve[] {
    // Collect segment-level split info per curve.
    // Each split is identified by the exact Bézier segment + local t
    // from bezier-js, avoiding any global-t round-trip imprecision.
    const splitsByCurve: Map<number, SegmentSplit[]> = new Map();

    for (const record of intersections) {
        const { curveIndexA, curveIndexB, intersection } = record;

        if (!splitsByCurve.has(curveIndexA)) splitsByCurve.set(curveIndexA, []);
        if (!splitsByCurve.has(curveIndexB)) splitsByCurve.set(curveIndexB, []);

        splitsByCurve.get(curveIndexA)!.push({
            segmentIndex: intersection.segSelf,
            localT: intersection.tLocalSelf,
        });
        splitsByCurve.get(curveIndexB)!.push({
            segmentIndex: intersection.segOther,
            localT: intersection.tLocalOther,
        });
    }

    const allSegments: Curve[] = [];

    for (let i = 0; i < curves.length; i++) {
        const splits = splitsByCurve.get(i);
        if (!splits || splits.length === 0) {
            allSegments.push(curves[i]);
            continue;
        }

        const numSegs = curves[i].segments.length;

        // Filter out splits at curve endpoints
        const filtered = splits.filter(s =>
            !(s.segmentIndex === 0 && s.localT < 1e-4) &&
            !(s.segmentIndex === numSegs - 1 && s.localT > 1 - 1e-4),
        );

        // Sort by segment index, then by local t
        filtered.sort((a, b) =>
            a.segmentIndex !== b.segmentIndex
                ? a.segmentIndex - b.segmentIndex
                : a.localT - b.localT,
        );

        // Deduplicate splits on the same segment
        const deduped: SegmentSplit[] = [];
        for (const s of filtered) {
            const last = deduped[deduped.length - 1];
            if (last && last.segmentIndex === s.segmentIndex &&
                Math.abs(last.localT - s.localT) < 1e-3) {
                continue;
            }
            deduped.push(s);
        }

        if (deduped.length === 0) {
            allSegments.push(curves[i]);
            continue;
        }

        // Split from end to start to preserve segment indices.
        // When multiple splits land on the same segment, we must
        // remap localT after each split (the segment gets shorter).
        let current = curves[i];
        const pieces: Curve[] = [];

        // Track the "consumed" portion of each segment
        // for remapping subsequent splits on the same segment.
        let lastSplitSeg = -1;
        let lastSplitLocalT = 1; // upper bound of remaining segment

        for (let j = deduped.length - 1; j >= 0; j--) {
            const { segmentIndex, localT } = deduped[j];

            let adjustedLocalT: number;
            if (segmentIndex === lastSplitSeg) {
                // Same segment as previous split (going backwards).
                // The previous split truncated this segment at lastSplitLocalT.
                // Remap: localT in [0, lastSplitLocalT] → [0, 1]
                adjustedLocalT = localT / lastSplitLocalT;
            } else {
                adjustedLocalT = localT;
                lastSplitSeg = segmentIndex;
            }
            lastSplitLocalT = localT; // in original segment space

            const [before, after] = current.splitAtSegmentLocal(segmentIndex, adjustedLocalT);
            pieces.unshift(after);
            current = before;
        }
        pieces.unshift(current);

        allSegments.push(...pieces);
    }

    return allSegments;
}

// ---------------------------------------------------------------------------
// Step 2b: Split closed curves
// ---------------------------------------------------------------------------

/**
 * Split any still-closed curves (where start === end within
 * VERTEX_MERGE_TOLERANCE) at t=0.5 to create two distinct half-edges.
 *
 * Runs AFTER intersection-splitting because closed curves that cross
 * other curves are already split at the crossings into open arcs and
 * don't need this treatment. Only truly free-floating closed inputs
 * (e.g. an isolated `Curve.circle` that doesn't cross anything else)
 * survive intersection-splitting still-closed and need to be cracked
 * here so the DCEL doesn't reject them as zero-length self-loops.
 *
 * The t=0.5 split is arbitrary; for a 4-segment kappa-circle it lands
 * at the leftmost cardinal point, which is fine. For other closed
 * curves with non-uniform segment distribution it could land in a
 * numerically awkward spot, but no current generator emits such
 * inputs.
 */
function splitClosedCurves(segments: Curve[]): Curve[] {
    const result: Curve[] = [];

    for (const segment of segments) {
        const startDist = pointDist(segment.start, segment.end);
        if (startDist < VERTEX_MERGE_TOLERANCE) {
            // This is a closed curve; split it at t=0.5
            const [first, second] = segment.splitAt(0.5);
            result.push(first, second);
        } else {
            result.push(segment);
        }
    }

    return result;
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

/**
 * Allocate a pair of twin half-edges for a curve segment.
 *
 * Wires up the cyclic `twin` field (which can't be set at allocation time
 * due to the chicken-and-egg of mutual references) and seeds `next`/`prev`
 * with self-pointers; Step 5 `linkHalfEdges` overwrites those once the
 * angular ordering at each vertex is known.
 *
 * The returned pair is narrowed to `HalfEdge` because all cyclic fields
 * are non-null after this function returns.
 */
function makeTwinPair(
    id1: number,
    id2: number,
    originA: Vertex,
    originB: Vertex,
    curve: Curve,
): [HalfEdge, HalfEdge] {
    const he1: MutableHalfEdge = {
        id: id1, origin: originA, curve,
        twin: null, next: null, prev: null, face: null,
    };
    const he2: MutableHalfEdge = {
        id: id2, origin: originB, curve: curve.reverse(),
        twin: null, next: null, prev: null, face: null,
    };
    he1.twin = he2;
    he2.twin = he1;
    he1.next = he1; he1.prev = he1;
    he2.next = he2; he2.prev = he2;
    return [he1 as HalfEdge, he2 as HalfEdge];
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
            innerBoundaries: [],
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

