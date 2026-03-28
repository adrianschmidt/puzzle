/**
 * Mate relationship detection from DCEL topology.
 *
 * Given a DCEL with faces identified, determines which edges are shared
 * between two pieces (faces) and which are on the puzzle border.
 *
 * This falls out naturally from the DCEL structure:
 * - Each half-edge belongs to one face
 * - Its twin belongs to the adjacent face
 * - Twin's face is outer → border edge
 * - Otherwise → shared edge (mate)
 *
 * See issue #170 for design discussion.
 */

import type { Face, HalfEdge, DCELResult } from './dcel.js';
import { getFaceEdges } from './dcel.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A mate relationship between two faces (pieces) sharing an edge.
 */
export interface MateRelationship {
    /** Half-edge on the first face's boundary. */
    halfEdge: HalfEdge;
    /** The face (piece) this half-edge belongs to. */
    face: Face;
    /** The adjacent face (piece) on the twin side. */
    mateFace: Face;
    /**
     * Shared edge key — identical for both sides of the same edge.
     * Format: "he_{min}_{max}" where min/max are the half-edge IDs.
     */
    sharedEdgeKey: string;
    /**
     * True if this is the "first side" — the side that defines the
     * canonical curve direction. The second side reverses it.
     */
    isFirstSide: boolean;
}

/**
 * A border edge on the puzzle boundary (no mate).
 */
export interface BorderEdge {
    /** Half-edge on the inner face's boundary. */
    halfEdge: HalfEdge;
    /** The face (piece) this border edge belongs to. */
    face: Face;
}

/**
 * Complete mate analysis for a DCEL.
 */
export interface MateAnalysis {
    /** All mate relationships (one entry per half-edge on a shared edge). */
    mates: MateRelationship[];
    /** All border edges. */
    borders: BorderEdge[];
    /** Map from face ID to its mate relationships. */
    matesByFace: Map<number, MateRelationship[]>;
    /** Map from face ID to its border edges. */
    bordersByFace: Map<number, BorderEdge[]>;
    /** Map from shared edge key to the two mate relationships. */
    matesByKey: Map<string, [MateRelationship, MateRelationship]>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze mate relationships from a DCEL result.
 *
 * @param dcel - The DCEL result from buildDCEL()
 * @returns Complete mate analysis
 */
export function analyzeMates(dcel: DCELResult): MateAnalysis {
    const mates: MateRelationship[] = [];
    const borders: BorderEdge[] = [];
    const matesByFace = new Map<number, MateRelationship[]>();
    const bordersByFace = new Map<number, BorderEdge[]>();
    const matesByKey = new Map<string, [MateRelationship, MateRelationship]>();

    // Process each inner face
    const innerFaces = dcel.faces.filter(f => !f.isOuter);

    for (const face of innerFaces) {
        const edges = getFaceEdges(face);

        for (const he of edges) {
            const twinFace = he.twin.face;

            if (!twinFace || twinFace.isOuter) {
                // Border edge — twin is on the outer face
                const border: BorderEdge = { halfEdge: he, face };
                borders.push(border);

                if (!bordersByFace.has(face.id)) bordersByFace.set(face.id, []);
                bordersByFace.get(face.id)!.push(border);
            } else {
                // Shared edge — twin is on another inner face
                const minId = Math.min(he.id, he.twin.id);
                const maxId = Math.max(he.id, he.twin.id);
                const sharedEdgeKey = `he_${minId}_${maxId}`;
                const isFirstSide = he.id === minId;

                const mate: MateRelationship = {
                    halfEdge: he,
                    face,
                    mateFace: twinFace,
                    sharedEdgeKey,
                    isFirstSide,
                };
                mates.push(mate);

                if (!matesByFace.has(face.id)) matesByFace.set(face.id, []);
                matesByFace.get(face.id)!.push(mate);

                // Build the key→pair map (both sides added when both faces are processed)
                if (!matesByKey.has(sharedEdgeKey)) {
                    matesByKey.set(sharedEdgeKey, [mate, mate]); // placeholder
                }
                const pair = matesByKey.get(sharedEdgeKey)!;
                if (isFirstSide) {
                    pair[0] = mate;
                } else {
                    pair[1] = mate;
                }
            }
        }
    }

    return { mates, borders, matesByFace, bordersByFace, matesByKey };
}

/**
 * Verify mate consistency: every shared edge should appear exactly twice
 * (once per face), and the two sides should reference each other.
 *
 * @returns An array of error messages (empty if consistent)
 */
export function verifyMateConsistency(analysis: MateAnalysis): string[] {
    const errors: string[] = [];

    for (const [key, pair] of analysis.matesByKey) {
        if (pair[0].face === pair[1].face) {
            errors.push(
                `Shared edge ${key}: both sides belong to the same face ${pair[0].face.id}`,
            );
        }

        if (pair[0].mateFace !== pair[1].face || pair[1].mateFace !== pair[0].face) {
            errors.push(
                `Shared edge ${key}: mate references are not bidirectional`,
            );
        }

        if (pair[0].isFirstSide === pair[1].isFirstSide) {
            errors.push(
                `Shared edge ${key}: both sides claim to be ${pair[0].isFirstSide ? 'first' : 'second'} side`,
            );
        }
    }

    return errors;
}
