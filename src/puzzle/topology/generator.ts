/**
 * Topology-driven puzzle generator.
 *
 * Single-pass pipeline:
 *   1. BaseCutGenerator → input cuts (Curves)
 *   2. buildDCEL → topology graph (single intersection pass)
 *   3. applyTabs → per-edge tab application with collision rejection
 *   4. facesToPieceDefinitions → PieceDefinition[]
 *   5. composePuzzle → final Piece[]
 *
 * The base-cut and tab generators are looked up from the registry by
 * id, so the same code path serves the sine grid, Venn diagrams, and
 * any future plug-ins. See issue #166 for the architecture.
 */

import type { Piece, Point, Size } from '../../model/types.js';
import { buildDCEL, getFaceEdges } from './dcel.js';
import type { Face, HalfEdge } from './dcel.js';
import { facesToPieceDefinitions } from './faces-to-pieces.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import { composePuzzle } from '../composable/compose.js';
import { applyTabs } from './apply-tabs.js';
import { getBaseCutGenerator, getTabGenerator } from './generator-registry.js';
import { diagnostics } from '../../diagnostics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the topology generator.
 *
 * The base-cut and tab generators are referenced by id (looked up
 * via the registry); their parameters are passed as opaque records
 * that each generator validates internally. Use `tabGeneratorId:
 * 'none'` to skip tab application entirely.
 */
export interface TopologyGeneratorConfig {
    /** Base-cut generator id (default: 'sine'). */
    baseCutGeneratorId?: string;
    /** Opaque config forwarded to the base-cut generator. */
    baseCutConfig?: Record<string, unknown>;
    /** Tab generator id (default: 'classic'; pass 'none' to skip). */
    tabGeneratorId?: string;
    /** Opaque config forwarded to the tab generator. */
    tabConfig?: Record<string, unknown>;
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
    const baseCutId = config?.baseCutGeneratorId ?? 'sine';
    const tabId = config?.tabGeneratorId ?? 'classic';

    // 1. Generate the cuts. The sine grid needs cols/rows; other
    //    generators that ignore them aren't harmed by their presence.
    const baseCutGenerator = getBaseCutGenerator(baseCutId);
    const baseCutCfg = {
        cols, rows,
        ...(config?.baseCutConfig ?? {}),
    };
    const curves = baseCutGenerator.generate(imageSize, random, baseCutCfg);

    diagnostics.log('cuts', `Generated ${curves.length} curves (4 border + ${curves.length - 4} internal)`, {
        curveSegments: curves.map((c, i) => ({
            index: i,
            segments: c.segments.length,
            start: c.start,
            end: c.end,
        })),
    });

    // 2. Build the topology graph in a single intersection pass.
    const graph = buildDCEL({ curves });

    // 3. Apply tabs per edge with collision rejection. The graph's
    //    topology is unchanged — only edge curves are swapped.
    if (tabId !== 'none') {
        const tabGenerator = getTabGenerator(tabId);
        applyTabs(graph, tabGenerator, random, { tabConfig: config?.tabConfig });
    }

    // 4. Faces → piece definitions. The expectedPieceCount drives
    //    mergeSmallFaces (kept for now; removed in Plan 3 once
    //    auto-grouping replaces it).
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
    logFaceDetails('dcel-pre-merge', graph.faces, computeArea as (face: Face) => number);

    const pieceDefs = facesToPieceDefinitions(graph, cols * rows);

    logFaceDetails('dcel-post-merge', graph.faces, computeArea as (face: Face) => number);
    diagnostics.log('pieces', `Generated ${pieceDefs.length} piece definitions`);

    // 5. Compose final pieces. Tabs (when enabled) are already in the
    //    edge geometry, so disable the composition layer's own tab
    //    logic.
    return composePuzzle(pieceDefs, classicTabTemplate, random, { disableTabs: true });
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
