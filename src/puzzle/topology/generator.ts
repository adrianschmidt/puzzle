/**
 * Topology-driven puzzle generator.
 *
 * Generates puzzle pieces using the full topology pipeline:
 *   1. Create border + internal cut lines as Curves
 *   2. Optionally merge tabs into internal cuts
 *   3. Build DCEL → find faces → extract PieceDefinitions
 *   4. Feed into composePuzzle() for final Piece[]
 *
 * Replaces the grid-based composable generator with a topology-driven
 * approach where pieces are defined by the enclosed regions of
 * intersecting cut lines.
 *
 * See issue #166 for the architecture.
 */

import type { Piece, Point, Size } from '../../model/types.js';
import { buildDCEL, getFaceEdges } from './dcel.js';
import type { HalfEdge, Face } from './dcel.js';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { composePuzzle, DEFAULT_DISABLE_TABS } from '../composable/compose.js';
import { mergeTabsIntoCuts, DEFAULT_TAB_PLACEMENT } from './tab-merge.js';
import type { CollisionOptions } from './tab-merge.js';
import { resolveExcessIntersections } from './collision.js';
import { diagnostics } from '../../diagnostics.js';
import { sineCutGenerator } from './sine-cut-generator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the topology generator.
 * All parameters are optional — sensible defaults are used.
 */
export interface TopologyGeneratorConfig {
    /** Horizontal cut wave amplitude (0–0.5, fraction of piece height). Default: 0.15 */
    horizontalAmplitude?: number;
    /** Horizontal cut wave frequency in Hz (0–10). Default: 1.5 */
    horizontalFrequency?: number;
    /** Vertical cut wave amplitude (0–0.5, fraction of piece width). Default: 0.15 */
    verticalAmplitude?: number;
    /** Vertical cut wave frequency in Hz (0–10). Default: 1.5 */
    verticalFrequency?: number;
    /** When true, skip tab generation — all shared edges are flat lines. Default: false */
    disableTabs?: boolean;
    /** Tab shape template. Default: classicTabTemplate */
    tabTemplate?: TabTemplate;
    /** Collision detection and resolution options for tabs. */
    collision?: CollisionOptions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a puzzle using the topology-driven pipeline.
 *
 * @param cols - Number of piece columns
 * @param rows - Number of piece rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param random - Seeded PRNG function
 * @param config - Optional generator configuration
 * @returns Complete Piece[] ready for the game engine
 */
export function generateTopologyPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    random: () => number,
    config?: TopologyGeneratorConfig,
): Piece[] {
    const hAmp = config?.horizontalAmplitude ?? 0.15;
    const hFreq = config?.horizontalFrequency ?? 1.5;
    const vAmp = config?.verticalAmplitude ?? 0.15;
    const vFreq = config?.verticalFrequency ?? 1.5;
    const disableTabs = config?.disableTabs ?? DEFAULT_DISABLE_TABS;
    const template = config?.tabTemplate ?? classicTabTemplate;

    // Step 1: Generate border and internal cut lines as Curves
    const curves = sineCutGenerator.generate(imageSize, random, {
        cols, rows,
        ha: hAmp, hf: hFreq, va: vAmp, vf: vFreq,
    });

    diagnostics.log('cuts', `Generated ${curves.length} curves (4 border + ${curves.length - 4} internal)`, {
        curveSegments: curves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // Step 1b: Resolve excess intersections between base cuts.
    // High-amplitude sine waves can cross more times than expected,
    // creating tiny lens-shaped regions. We splice out the lens
    // segment from one curve so the other curve is the sole path
    // through that region. This avoids near-coincident paths that
    // cause phantom intersections. (See issues #219, #220.)
    let finalCurves = resolveExcessIntersections(curves, 4);

    diagnostics.log('splice', `After splice: ${finalCurves.length} curves (was ${curves.length})`, {
        curveSegments: finalCurves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // Step 2: Merge tabs into cut lines BEFORE topology computation.
    // This ensures piece clip paths include tab protrusions/sockets.
    // The DCEL then sees the full tab-modified geometry.
    if (!disableTabs) {
        const borderIndices = new Set([0, 1, 2, 3]);
        finalCurves = mergeTabsIntoCuts(
            finalCurves, borderIndices, template, DEFAULT_TAB_PLACEMENT, random,
            config?.collision,
        );
    }

    // Step 3: Build DCEL on (possibly tab-modified) cuts → faces → pieces
    const dcel = buildDCEL({ curves: finalCurves });

    // Log DCEL state before face merging
    const computeArea = (face: { outerEdge: HalfEdge }) => {
        let area = 0;
        let current = face.outerEdge;
        do {
            const a = current.origin.position;
            const b = current.twin.origin.position;
            area += (a.x * b.y - b.x * a.y);
            current = current.next;
        } while (current !== face.outerEdge);
        return area / 2;
    };
    logFaceDetails('dcel-pre-merge', dcel.faces, computeArea as (face: Face) => number);

    const expectedPieceCount = cols * rows;
    const pieceDefs = facesToPieceDefinitions(dcel, expectedPieceCount);

    logFaceDetails('dcel-post-merge', dcel.faces, computeArea as (face: Face) => number);
    diagnostics.log('pieces', `Generated ${pieceDefs.length} piece definitions`);

    // Step 4: Compose final pieces — tabs are already in the geometry
    return composePuzzle(pieceDefs, template, random, { disableTabs: true });
}

// ---------------------------------------------------------------------------
// DCEL face logging (used by tests via the diagnostics singleton)
// ---------------------------------------------------------------------------

function logFaceDetails(
    stage: string,
    faces: Face[],
    computeArea: (face: Face) => number,
): void {
    if (!diagnostics.enabled) return;
    const innerFaces = faces.filter(f => !f.isOuter);
    diagnostics.log(stage, `Total faces: ${faces.length}, inner: ${innerFaces.length}`);

    for (const face of innerFaces) {
        const edges = getFaceEdges(face);
        const area = computeArea(face);
        const verts = edges.map(e => e.origin.position);
        const bbox = computeBBox(verts);
        diagnostics.log(stage, `Face ${face.id}: edges=${edges.length}, area=${area.toFixed(1)}, bbox=${bboxStr(bbox)}`);
    }
}

function computeBBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function bboxStr(b: { minX: number; minY: number; maxX: number; maxY: number }): string {
    return `[${b.minX.toFixed(0)},${b.minY.toFixed(0)}]→[${b.maxX.toFixed(0)},${b.maxY.toFixed(0)}]`;
}

